import { cleanText, linkInput } from '@/lib/text-input';
import { mediaAssets } from '@/db/media-schema';
import { ownMediaId, localMediaUrl, mediaUrl } from '@/lib/media/url';
import { ApiError } from "./errors";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { brands, channels, posts, postTargets, postEvents, workspaces } from "@/db/schema";
import { newApprovalToken } from "@/lib/approvals";
import { localDateTime } from "@/lib/timezone";
import { derivePostStatus } from "@/lib/publishing";
import { workspaceEntitlements } from "@/lib/entitlements";
import { validatePublicUrl } from "@/lib/publishers/safe-fetch";
import { channelTextLimit, countChannelText, countText, MAX_POST_TEXT_LENGTH, postText } from "@/lib/text-limits";
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
      const body = cleanText(str(form, "body")),
        mediaUrls = str(form, "mediaUrls").split(/\s+/).filter(Boolean).map(linkInput).map(url => { const id = ownMediaId(url); return id ? mediaUrl(id) : url; }),
        linkUrl = linkInput(str(form, "linkUrl"));
      check(
        countText(body) > 0,
        "Write your post.",
      );
      if (countText(body) > MAX_POST_TEXT_LENGTH)
        throw new ApiError(422, "validation_error", "Post text must be 10,000 characters or fewer", undefined, "body");
      check(
        mediaUrls.length <= 4 && mediaUrls.every(u => https(u) || localMediaUrl(u) || !!ownMediaId(u)),
        "Use up to four HTTPS media URLs.",
      );
      for (const [index, url] of mediaUrls.entries()) {
        try { if (!ownMediaId(url)) await validatePublicUrl(url); }
        catch { throw new InputError(`media_urls[${index}]: Use a reachable public HTTPS media URL. DNS may be temporarily unavailable; check the URL and try again.`); }
      }
      const ids = [...new Set(form.getAll("channelId").map(String))];
      check(ids.length <= 100 && ids.every(isUuid), "Choose valid channels.");
      const selected = (
        await db.select().from(channels).where(eq(channels.brandId, brandId))
      ).filter((c) => ids.includes(c.id));
      if (selected.length !== ids.length) throw new ApiError(404, "not_found", "Channel not found.");
      check(
        str(form,"intent") === "draft" || selected.every(c => c.status === "active"),
        "A selected channel is unavailable.",
      );
      for (const c of selected) {
        const max = channelTextLimit(c);
        check(
          !max || countChannelText(postText({ text: body, linkUrl }), c.provider) <= max,
          `${c.displayName} supports ${max} characters.`,
        );
      }
      const draft = str(form, "intent") === "draft",
        requestedApproval = form.get("requiresApproval") === "on";
      let requiresApproval = requestedApproval;
      let mediaAlt: Record<string, string> = {};
      try { const parsed = JSON.parse(str(form, "mediaAlt") || "{}"); check(parsed && typeof parsed === "object" && !Array.isArray(parsed), "Invalid image descriptions."); mediaAlt = Object.fromEntries(mediaUrls.map(url => { const alt = parsed[url] ?? ""; check(typeof alt === "string" && alt.length <= 1000, "Image descriptions must be at most 1,000 characters."); return [url, cleanText(alt)]; })); } catch(e) { if (e instanceof InputError) throw e; throw new InputError("Invalid image descriptions."); }
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
      let status: typeof posts.$inferSelect.status = draft
        ? "draft"
        : requiresApproval
          ? "pending_approval"
          : "scheduled";
      const save = async (tx: Tx) => {
        await tx.select({id:workspaces.id}).from(workspaces).where(eq(workspaces.id,workspace.id)).for('update');
        for (const url of mediaUrls) {
          const assetId = ownMediaId(url);
          if (!assetId) continue;
          const [asset] = await tx.select({id:mediaAssets.id}).from(mediaAssets).where(and(eq(mediaAssets.id,assetId),eq(mediaAssets.workspaceId,workspace.id)));
          check(asset, 'Uploaded image not found in this workspace.');
        }
        let approvalReset = false;
        let approvalResubmitted = false;
        let approvalToken = requiresApproval && !draft ? newApprovalToken() : null;
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
            ["draft", "pending_approval", "changes_requested", "scheduled", "approved"].includes(
              old.post.status,
            ),
            "This post can no longer be edited.",
          );
          const targets = await tx.select().from(postTargets).where(eq(postTargets.postId, id)).for('update');
          check(!targets.some(t => ['publishing', 'published'].includes(t.status) || t.attempts > 0), 'Publishing has started; this post cannot be edited.');
          // An existing approval requirement cannot be removed by editing approved content.
          if (old.post.requiresApproval && ['approved','scheduled'].includes(old.post.status)) {
            check(access.approvalLinks, "Client approval requires Agency.");
            requiresApproval = true;
            status = draft ? 'draft' : 'pending_approval';
            approvalReset = true;
          }
          if (old.post.status === 'changes_requested' && !draft) {
            check(access.approvalLinks, "Client approval requires Agency.");
            requiresApproval = true;
            status = 'pending_approval';
            // Keep the link the reviewer already received. Explicit link
            // regeneration remains a separate, intentional action.
            approvalToken = old.post.approvalToken;
            approvalResubmitted = true;
          }
          await tx.delete(postTargets).where(eq(postTargets.postId, id));
        }
        const values = {
          brandId,
          authorUserId: userId,
          body,
          mediaUrls,
          mediaAlt,
          linkUrl: linkUrl || null,
          scheduledAt,
          status,
          requiresApproval,
          approvalToken,
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
            message: approvalReset ? "Approval reset — edited content requires client approval again" : approvalResubmitted
              ? "Edited content resubmitted for client approval"
              : draft
              ? "Draft saved"
              : requiresApproval
                ? "Awaiting client approval"
                : `Scheduled for ${scheduledAt!.toISOString()} (${brand.timezone})`,
          });
        return post.id;
      };
      const result = transaction ? await save(transaction) : await db.transaction(save);
      return result;
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

/** Copy under the workspace lock so retention cannot remove inherited media. */
export async function duplicatePost(ctx: PostContext, id: string) {
  check(isUuid(id), 'Post not found.');
  const access = ctx.access ?? await workspaceEntitlements(ctx.workspace);
  return ctx.db.transaction(async tx => {
    await tx.select({id:workspaces.id}).from(workspaces).where(eq(workspaces.id,ctx.workspace.id)).for('update');
    const [source] = await tx.select({post:posts}).from(posts).innerJoin(brands,eq(brands.id,posts.brandId))
      .where(and(eq(posts.id,id),eq(brands.workspaceId,ctx.workspace.id))).for('share',{of:posts});
    check(source,'Post not found.');
    const p = source.post;
    check(access.activeBrandIds.includes(p.brandId),'This brand is read-only under your plan. Review Billing.');
    const [copy] = await tx.insert(posts).values({brandId:p.brandId, authorUserId:ctx.userId, body:p.body,
      mediaUrls:p.mediaUrls, mediaAlt:p.mediaAlt, linkUrl:p.linkUrl, status:'draft', scheduledAt:null, requiresApproval:false}).returning();
    const targets = await tx.select({channelId:postTargets.channelId}).from(postTargets).where(eq(postTargets.postId,id));
    if(targets.length) await tx.insert(postTargets).values(targets.map(t=>({postId:copy.id,channelId:t.channelId,nextAttemptAt:null})));
    await tx.insert(postEvents).values({postId:copy.id,type:'draft',message:'Draft duplicated from an existing post'});
    return copy.id;
  });
}

/** The worker and editor must lock the post before locking its targets. */
export async function reschedulePost(ctx: PostContext, id: string, value: string, isoDate = true) {
  check(isUuid(id), 'Post not found.');
  const access = ctx.access ?? await workspaceEntitlements(ctx.workspace);
  check(access.publish, 'Publishing requires an active plan or trial. Review Billing.');
  return ctx.db.transaction(async tx => {
    const [row] = await tx.select({post:posts, timezone:brands.timezone}).from(posts).innerJoin(brands, eq(brands.id,posts.brandId))
      .where(and(eq(posts.id,id),eq(brands.workspaceId,ctx.workspace.id))).for('update',{of:posts});
    check(row, 'Post not found.');
    check(access.activeBrandIds.includes(row.post.brandId), 'This brand is read-only under your plan.');
    if (!['scheduled','approved'].includes(row.post.status)) throw new ApiError(409,'invalid_status','Only scheduled or approved posts can be rescheduled.');
    const targets = await tx.select().from(postTargets).where(eq(postTargets.postId,id)).for('update');
    if (targets.some(t => ['publishing','published'].includes(t.status))) throw new ApiError(409,'invalid_status','Publishing has started; this post cannot be rescheduled.');
    let date: Date;
    try { date = isoDate ? new Date(value) : localDateTime(value,row.timezone); } catch { throw new InputError('Choose a valid date and time.'); }
    check(Number.isFinite(date.getTime()) && date.getTime() > Date.now(), 'Choose a future date and time.');
    await tx.update(posts).set({scheduledAt:date,updatedAt:new Date()}).where(eq(posts.id,id));
    await tx.update(postTargets).set({nextAttemptAt:date,updatedAt:new Date()}).where(and(eq(postTargets.postId,id),eq(postTargets.status,'queued')));
    await tx.insert(postEvents).values({postId:id,type:'rescheduled',message:`Rescheduled to ${date.toISOString()} (${row.timezone})`});
    return id;
  });
}
