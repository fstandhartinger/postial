import { ApiError } from "./errors";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { brands, channels, posts, postTargets, postEvents } from "@/db/schema";
import { newApprovalToken } from "@/lib/approvals";
import { localDateTime } from "@/lib/timezone";
import { derivePostStatus } from "@/lib/publishing";
import { workspaceEntitlements } from "@/lib/entitlements";
import { validatePublicUrl } from "@/lib/publishers/safe-fetch";
import { channelTextLimit, countText, postText } from "@/lib/text-limits";
export type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];
export type PostContext = { db: ReturnType<typeof getDb>; workspace: {id: string}; userId: string; access?: Awaited<ReturnType<typeof workspaceEntitlements>> };
import { isUuid, str, InputError, check, https } from "./input";
export { isUuid, InputError, check, https } from "./input";

export async function savePost(ctx: PostContext, form: FormData, isoDate = false, transaction?: Tx) {
 const {workspace, userId} = ctx;
 const db = transaction ?? ctx.db;
 const access = ctx.access ?? await workspaceEntitlements(workspace);
      const brandId = str(form, "brandId"),
        id = str(form, "postId");
      check(isUuid(brandId), "Choose a brand.");
      const [brand] = await db
        .select()
        .from(brands)
        .where(
          and(eq(brands.id, brandId), eq(brands.workspaceId, workspace.id)),
        );
      check(brand, "Brand not found.");
      check(access.activeBrandIds.includes(brandId), "This brand is read-only under your plan. Review Billing.");
      const body = str(form, "body"),
        mediaUrls = str(form, "mediaUrls").split(/\s+/).filter(Boolean),
        linkUrl = str(form, "linkUrl");
      check(
        body.length > 0 && body.length <= 100000,
        "Write your post (up to 100,000 characters).",
      );
      check(
        mediaUrls.length <= 4 && mediaUrls.every(https),
        "Use up to four HTTPS media URLs.",
      );
      for (const [index, url] of mediaUrls.entries()) {
        try { await validatePublicUrl(url); }
        catch { throw new InputError(`media_urls[${index}]: Use a reachable public HTTPS media URL. DNS may be temporarily unavailable; check the URL and try again.`); }
      }
      check(!linkUrl || https(linkUrl), "Use an HTTPS link.");
      const ids = [...new Set(form.getAll("channelId").map(String))];
      check(ids.every(isUuid), "Choose valid channels.");
      const selected = (
        await db.select().from(channels).where(eq(channels.brandId, brandId))
      ).filter((c) => ids.includes(c.id));
      if (selected.length !== ids.length) throw new ApiError(404, "not_found", "Channel not found.");
      check(
        selected.every(c => c.status === "active"),
        "A selected channel is unavailable.",
      );
      for (const c of selected) {
        const max = channelTextLimit(c);
        check(
          !max || countText(postText({ text: body, linkUrl })) <= max,
          `${c.displayName} supports ${max} characters.`,
        );
      }
      const draft = str(form, "intent") === "draft",
        requiresApproval = form.get("requiresApproval") === "on";
      check(!requiresApproval || access.approvalLinks, "requires_approval: Included with Agency — upgrade to use client approval links.");
      check(
        draft || selected.length > 0,
        "Connect and select at least one channel.",
      );
      let scheduledAt: Date | null = null;
      if (!draft) {
        check(access.publish, "Publishing requires an active plan or trial. Review Billing.");
        if (str(form, "when") === "now") scheduledAt = new Date();
        else {
          try {
            scheduledAt = isoDate ? new Date(str(form, "scheduledAt")) : localDateTime(str(form, "scheduledAt"), brand.timezone);
          } catch (e) {
            throw new InputError((e as Error).message);
          }
          check(
            scheduledAt.getTime() > Date.now(),
            "Choose a future time or Publish now.",
          );
        }
      }
      const status = draft
        ? "draft"
        : requiresApproval
          ? "pending_approval"
          : "scheduled";
      const save = async (tx: Tx) => {
        if (id) {
          check(isUuid(id), "Post not found.");
          const [old] = await tx
            .select({ post: posts })
            .from(posts)
            .innerJoin(brands, eq(brands.id, posts.brandId))
            .where(and(eq(posts.id, id), eq(brands.workspaceId, workspace.id)))
            .for("update", { of: posts });
          check(old, "Post not found.");
          check(access.activeBrandIds.includes(old.post.brandId), "This brand is read-only under your plan. Review Billing.");
          check(
            ["draft", "pending_approval", "changes_requested"].includes(
              old.post.status,
            ),
            "Only drafts or posts awaiting approval can be edited.",
          );
          await tx.delete(postTargets).where(eq(postTargets.postId, id));
        }
        const values = {
          brandId,
          authorUserId: userId,
          body,
          mediaUrls,
          linkUrl: linkUrl || null,
          scheduledAt,
          status,
          requiresApproval,
          approvalToken:
            requiresApproval && !draft ? newApprovalToken() : null,
          approvalNote: null,
          updatedAt: new Date(),
        } as const;
        const [post] = id
          ? await tx
              .update(posts)
              .set(values)
              .where(eq(posts.id, id))
              .returning()
          : await tx.insert(posts).values(values).returning();
        if (selected.length)
          await tx
            .insert(postTargets)
            .values(
              selected.map((c) => ({
                postId: post.id,
                channelId: c.id,
                nextAttemptAt: status === "scheduled" ? scheduledAt : null,
              })),
            );
        await tx
          .insert(postEvents)
          .values({
            postId: post.id,
            type: status,
            message: draft
              ? "Draft saved"
              : requiresApproval
                ? "Awaiting client approval"
                : `Scheduled for ${scheduledAt!.toISOString()} (${brand.timezone})`,
          });
        return post.id;
      };
      return transaction ? save(transaction) : db.transaction(save);
}
export async function changeTarget(ctx: PostContext, form: FormData, action: "retry" | "skip", transaction?: Tx) {
 const {db, workspace} = ctx;
 const access = ctx.access ?? await workspaceEntitlements(workspace);
      const id = str(form, "targetId");
      check(isUuid(id), "Target not found.");
      const change = async (tx: Tx) => {
        const [row] = await tx
          .select({ target: postTargets, post: posts, channel: channels })
          .from(postTargets)
          .innerJoin(posts, eq(posts.id, postTargets.postId))
          .innerJoin(brands, eq(brands.id, posts.brandId))
          .innerJoin(channels, eq(channels.id, postTargets.channelId))
          .where(
            and(eq(postTargets.id, id), eq(brands.workspaceId, workspace.id)),
          );
        check(row, "Target not found.");
        check(access.activeBrandIds.includes(row.post.brandId), "This brand is read-only under your plan. Review Billing.");
        await tx
          .select()
          .from(posts)
          .where(eq(posts.id, row.post.id))
          .for("update");
        const [target] = await tx
          .select()
          .from(postTargets)
          .where(eq(postTargets.id, id))
          .for("update");
        check(
          ["failed", "queued", "needs_review", "held"].includes(target.status),
          "This target cannot be changed during or after publishing.",
        );
        check(
          !["draft", "pending_approval", "changes_requested"].includes(
            row.post.status,
          ),
          "This post must be scheduled and approved first.",
        );
        if (action === "retry") {
          check(access.publish, "Publishing requires an active plan or trial. Review Billing.");
          check(
            row.channel.status === "active",
            "Reconnect the channel before retrying.",
          );
          check(
            ["failed", "needs_review", "held"].includes(target.status) || !!target.lastErrorCode,
            "This target is already scheduled.",
          );
        }
        await tx
          .update(postTargets)
          .set({
            status: action === "retry" ? "queued" : "skipped",
            ...(action === "retry" ? { attempts: 0, attemptStartedAt: null } : {}),
            nextAttemptAt: action === "retry" ? new Date() : null,
            updatedAt: new Date(),
          })
          .where(eq(postTargets.id, id));
        await tx
          .insert(postEvents)
          .values({
            postId: row.post.id,
            targetId: id,
            type: action,
            message: action === "retry" ? "Retry requested" : "Channel skipped",
          });
        await derivePostStatus(tx, row.post.id);
        return row.post.id;
      };
      return transaction ? change(transaction) : db.transaction(change);
}
