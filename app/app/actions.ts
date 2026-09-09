"use server";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  brands,
  channels,
  posts,
  postTargets,
  postEvents,
  workspaces,
} from "@/db/schema";
import { coreContext, isUuid } from "@/lib/core";
import { encryptCredentials } from "@/lib/crypto";
import { newApprovalToken } from "@/lib/approvals";
import {
  availableProviders,
  getPublisher,
  PublishError,
} from "@/lib/publishers";
import { localDateTime } from "@/lib/timezone";
import { derivePostStatus } from "@/lib/publishing";
import { workspaceEntitlements } from '@/lib/entitlements';
import { validatePublicUrl } from '@/lib/publishers/safe-fetch';
import { channelTextLimit, countText, postText } from '@/lib/text-limits';
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
class InputError extends Error {}
function check(ok: unknown, message: string): asserts ok {
  if (!ok) throw new InputError(message);
}
function https(value: string) {
  try {
    const u = new URL(value);
    return u.protocol === "https:" && !u.username && !u.password;
  } catch {
    return false;
  }
}
export async function coreAction(
  _state: { error: string },
  form: FormData,
): Promise<{ error: string }> {
  const { db, workspace, userId } = await coreContext();
  let destination = "/app";
  try {
    const action = str(form, "action");
    const access = await workspaceEntitlements(workspace);
    if (action === "brand") {
      const name = str(form, "name"),
        color = str(form, "color"),
        timezone = str(form, "timezone");
      check(
        name.length > 0 && name.length <= 80,
        "Enter a brand name (up to 80 characters).",
      );
      check(/^#[0-9a-f]{6}$/i.test(color), "Choose a valid color.");
      try {
        new Intl.DateTimeFormat("en", { timeZone: timezone }).format();
      } catch {
        throw new InputError("Enter an IANA timezone, such as Europe/Berlin.");
      }
      const limit = access.limit;
      const brand = await db.transaction(async (tx) => {
        await tx
          .select()
          .from(workspaces)
          .where(eq(workspaces.id, workspace.id))
          .for("update");
        const existing = await tx
          .select({ id: brands.id })
          .from(brands)
          .where(eq(brands.workspaceId, workspace.id));
        check(
          existing.length < limit,
          `Your plan supports ${limit} brands. Review Billing to upgrade.`,
        );
        const [b] = await tx
          .insert(brands)
          .values({
            workspaceId: workspace.id,
            name,
            color,
            timezone,
            slug:
              (name
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, "-")
                .replace(/^-|-$/g, "") || "brand") +
              "-" +
              crypto.randomUUID().slice(0, 8),
          })
          .returning();
        return b;
      });
      destination = `/app/brands/${brand.id}`;
    } else if (action === "connect" || action === "disconnect") {
      const brandId = str(form, "brandId");
      check(isUuid(brandId), "Choose a brand.");
      const [brand] = await db
        .select()
        .from(brands)
        .where(
          and(eq(brands.id, brandId), eq(brands.workspaceId, workspace.id)),
        );
      check(brand, "Brand not found.");
      check(access.activeBrandIds.includes(brandId), "This brand is read-only under your plan. Review Billing.");
      if (action === "connect") {
        const provider = availableProviders().find(
          (p) => p === str(form, "provider"),
        );
        check(provider, "Choose an available provider.");
        const publisher = getPublisher(provider);
        const credentials: Record<string, string> = {};
        for (const field of publisher.credentialFields) {
          credentials[field.key] = str(form, "credential:" + field.key);
          check(
            credentials[field.key] && credentials[field.key].length <= 10000,
            `Enter ${field.label}.`,
          );
        }
        const account = await publisher.validate(credentials);
        const values = {
          brandId,
          provider,
          credentialsEnc: encryptCredentials(credentials),
          displayName: account.displayName,
          externalId: account.externalId,
          url: account.url && https(account.url) ? account.url : null,
          meta: account.meta ?? {},
          lastCheckedAt: new Date(),
          status: "active" as const,
        };
        await db.transaction(async (tx) => {
          await tx
            .select()
            .from(brands)
            .where(eq(brands.id, brandId))
            .for("update");
          const [existing] = await tx
            .select({ id: channels.id })
            .from(channels)
            .where(
              and(
                eq(channels.brandId, brandId),
                eq(channels.provider, provider),
                eq(channels.externalId, account.externalId),
              ),
            );
          if (existing)
            await tx
              .update(channels)
              .set(values)
              .where(eq(channels.id, existing.id));
          else await tx.insert(channels).values(values);
        });
      } else {
        const id = str(form, "channelId");
        check(isUuid(id), "Choose a channel.");
        await db
          .update(channels)
          .set({ status: "disconnected", credentialsEnc: "" })
          .where(and(eq(channels.id, id), eq(channels.brandId, brandId)));
      }
      destination = `/app/brands/${brandId}`;
    } else if (action === "post") {
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
      for (const url of mediaUrls) await validatePublicUrl(url);
      check(!linkUrl || https(linkUrl), "Use an HTTPS link.");
      const ids = [...new Set(form.getAll("channelId").map(String))];
      check(ids.every(isUuid), "Choose valid channels.");
      const selected = (
        await db.select().from(channels).where(eq(channels.brandId, brandId))
      ).filter((c) => ids.includes(c.id) && c.status === "active");
      check(
        selected.length === ids.length,
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
            scheduledAt = localDateTime(
              str(form, "scheduledAt"),
              brand.timezone,
            );
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
      const postId = await db.transaction(async (tx) => {
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
      });
      destination = `/app/posts/${postId}`;
    } else if (action === "retry" || action === "skip") {
      const id = str(form, "targetId");
      check(isUuid(id), "Target not found.");
      const postId = await db.transaction(async (tx) => {
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
      });
      destination = `/app/posts/${postId}`;
    } else throw new InputError("Unknown action.");
  } catch (e) {
    return {
      error:
        e instanceof InputError
          ? e.message
          : e instanceof PublishError
            ? e.humanMessage
            : "Unable to save right now. Please try again.",
    };
  }
  revalidatePath("/app", "layout");
  redirect(destination);
}
