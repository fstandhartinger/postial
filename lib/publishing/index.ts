import { emit, emitPublishing } from "@/lib/api/webhooks";
import { workspaceEntitlements } from '@/lib/entitlements';
export const TELEGRAM_REVIEW = "We couldn't confirm whether Telegram received this post. Check the channel, then retry or skip.";
import { and, eq, inArray, lte, lt, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { brands, channels, posts, postTargets, postEvents } from "@/db/schema";
import { decryptCredentials } from "@/lib/crypto";
import { getPublisher, PublishError } from "@/lib/publishers";
type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];
export async function derivePostStatus(tx: Tx, postId: string) {
  const [previous] = await tx
    .select({ id: posts.id, status: posts.status })
    .from(posts)
    .where(eq(posts.id, postId))
    .for("no key update");
  const rows = await tx
    .select()
    .from(postTargets)
    .where(eq(postTargets.postId, postId));
  if (!rows.length) return;
  const active = rows.filter(r => r.status !== "skipped");
  const status = !active.length ? "skipped" : active.some((r) => r.status === "publishing")
    ? "publishing"
    : active.some((r) => r.status === "queued" || r.status === "held")
      ? "scheduled"
      : active.every((r) => r.status === "published")
        ? "published"
        : active.some((r) => r.status === "published")
          ? "partially_failed"
          : "failed";
  await tx
    .update(posts)
    .set({ status, updatedAt: new Date() })
    .where(eq(posts.id, postId));
  // API outbox shares the status/history transaction; delivery happens in the worker.
  if (previous) await emitPublishing(tx, postId, previous.status, status);
}
export async function tick() {
  const db = getDb();
  // Approval in part B changes the post to approved. Activate its held targets here.
  await db.execute(
    sql`update post_targets t set next_attempt_at = p.scheduled_at, updated_at = now() from posts p where t.post_id = p.id and t.status = 'queued' and t.next_attempt_at is null and p.status in ('approved','scheduled') and p.scheduled_at is not null`,
  );

  // Claims are committed before network IO. Attempt numbers fence late responses.
  await db.transaction(async (tx) => {
    const abandoned = await tx
      .select({ target: postTargets })
      .from(postTargets)
      .innerJoin(posts, eq(posts.id, postTargets.postId))
      .where(
        and(
          eq(postTargets.status, "publishing"),
          sql`coalesce(${postTargets.attemptStartedAt}, ${postTargets.updatedAt}) <= ${new Date(Date.now() - 600000).toISOString()}::timestamptz`,
        ),
      )
      .for("no key update", { of: posts, skipLocked: true })
      .limit(10);
    for (const { target: t } of abandoned) {
      const [channel] = await tx.select().from(channels).where(eq(channels.id, t.channelId));
      const status = t.attempts >= 5 ? "failed" : channel.provider === "telegram" ? "needs_review" : "queued";
      const message = channel.provider === "telegram" ? TELEGRAM_REVIEW : status === "failed" ? "Attempt limit reached. Check the remote account before retrying." : "Recovering interrupted attempt using provider idempotency";
      await tx
        .update(postTargets)
        .set({
          status,
          lastErrorCode: "UNCERTAIN",
          lastErrorHuman: message,
          nextAttemptAt: status === "queued" ? new Date() : null,
          updatedAt: new Date(),
        })
        .where(eq(postTargets.id, t.id));
      await tx.insert(postEvents).values({
        postId: t.postId,
        targetId: t.id,
        type: "recovered",
        message,
      });
      if (status === "needs_review") await emit(tx, t.postId, "post.needs_review", {target_id: t.id});
      await derivePostStatus(tx, t.postId);
    }
  });
  const held = await db.select({ target: postTargets, workspaceId: brands.workspaceId, brandId: brands.id }).from(postTargets)
    .innerJoin(posts, eq(posts.id, postTargets.postId)).innerJoin(brands, eq(brands.id, posts.brandId))
    .where(and(eq(postTargets.status, "held"), inArray(posts.status, ["scheduled", "approved", "publishing"]), lt(postTargets.attempts, 5)));
  for (const workspaceId of [...new Set(held.map(r => r.workspaceId))]) {
    const access = await workspaceEntitlements(workspaceId);
    if (!access.publish) continue;
    for (const row of held.filter(r => r.workspaceId === workspaceId && access.activeBrandIds.includes(r.brandId))) {
      await db.update(postTargets).set({ status: "queued", nextAttemptAt: new Date(), updatedAt: new Date() }).where(and(eq(postTargets.id, row.target.id), eq(postTargets.status, "held")));
    }
  }
  const claimed = await db.transaction(async (tx) => {
    const rows = await tx
      .select({ target: postTargets, post: posts, channel: channels })
      .from(postTargets)
      .innerJoin(posts, eq(posts.id, postTargets.postId))
      .innerJoin(channels, eq(channels.id, postTargets.channelId))
      .where(
        and(
          eq(postTargets.status, "queued"),
          lt(postTargets.attempts, 5),
          lte(postTargets.nextAttemptAt, new Date()),
          inArray(posts.status, ["scheduled", "approved", "publishing"]),
        ),
      )
      .for("update", { of: postTargets, skipLocked: true })
      .limit(10);
    for (const { target: t } of rows)
      await tx
        .update(postTargets)
        .set({
          status: "publishing",
          attempts: t.attempts + 1,
          attemptStartedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(postTargets.id, t.id));
    return rows;
  });
  for (const postId of [...new Set(claimed.map((row) => row.post.id))].sort()) {
    await db.transaction((tx) => derivePostStatus(tx, postId));
  }
  await Promise.all(
    claimed.map(async ({ target: t, post: p, channel: c }) => {
      const attempt = t.attempts + 1;
      const [brand] = await db.select().from(brands).where(eq(brands.id, p.brandId));
      const access = await workspaceEntitlements(brand.workspaceId);
      if (!access.publish || !access.activeBrandIds.includes(brand.id)) {
        await db.transaction(async tx => {
          const changed = await tx.update(postTargets).set({ status: "held", attempts: t.attempts, attemptStartedAt: null, nextAttemptAt: null, lastErrorHuman: !access.publish ? "Held: subscription inactive" : "Held: brand exceeds plan limit", updatedAt: new Date() })
            .where(and(eq(postTargets.id, t.id), eq(postTargets.status, "publishing"), eq(postTargets.attempts, attempt))).returning();
          if (changed.length) await tx.insert(postEvents).values({ postId: p.id, targetId: t.id, type: "held", message: !access.publish ? "Held: subscription inactive" : "Held: brand exceeds plan limit" });
          await derivePostStatus(tx, p.id);
        });
        return;
      }
      const controller = new AbortController();
      const heartbeat = setInterval(() => {
        void db.update(postTargets).set({ attemptStartedAt: new Date() }).where(and(eq(postTargets.id, t.id), eq(postTargets.status, "publishing"), eq(postTargets.attempts, attempt)))
          .catch(() => controller.abort());
      }, 30_000);
      const deadline = setTimeout(() => controller.abort(), 90_000);
      let result:
        | Awaited<ReturnType<ReturnType<typeof getPublisher>["publish"]>>
        | undefined;
      let error: PublishError | undefined;
      try {
        if (c.status !== "active")
          throw new PublishError({
            code: "AUTH_EXPIRED",
            retryable: false,
            humanMessage: "Reconnect this channel before retrying.",
          });
        result = await getPublisher(c.provider).publish(
          decryptCredentials(c.credentialsEnc),
          {
            text: p.body,
            mediaUrls: p.mediaUrls,
            linkUrl: p.linkUrl ?? undefined,
            idempotencyKey: t.id,
            signal: controller.signal,
            meta: c.meta,
          },
        );
      } catch (e) {
        error =
          e instanceof PublishError
            ? e
            : new PublishError({
                code: "UNKNOWN",
                retryable: true,
                humanMessage: "Publishing was interrupted. Please retry.",
              });
      }
      clearInterval(heartbeat);
      clearTimeout(deadline);
      await db.transaction(async (tx) => {
        // Lock the post first to serialize aggregate status updates across its targets.
        await tx
          .select({ id: posts.id })
          .from(posts)
          .where(eq(posts.id, p.id))
          .for("no key update");
        const [current] = await tx
          .select()
          .from(postTargets)
          .where(eq(postTargets.id, t.id))
          .for("no key update");
        if (
          !current ||
          current.status !== "publishing" ||
          current.attempts !== attempt
        )
          return;
        if (result) {
          await tx
            .update(postTargets)
            .set({
              status: "published",
              remoteId: result.remoteId,
              warnings: result.warnings ?? [],
              remoteUrl: result.url,
              publishedAt: new Date(),
              lastErrorCode: null,
              lastErrorHuman: null,
              nextAttemptAt: null,
              updatedAt: new Date(),
            })
            .where(eq(postTargets.id, t.id));
          await tx.insert(postEvents).values({
            postId: p.id,
            targetId: t.id,
            type: "published",
            message: `Published to ${c.displayName}${result.warnings?.length ? ` with a warning: ${result.warnings.join(" ")}` : ""}`,
          });
        } else if (error) {
          const uncertain = c.provider === "telegram" && ["NETWORK", "PROVIDER_DOWN", "UNKNOWN"].includes(error.code);
          const retry = !uncertain &&
            error.retryable &&
            !["AUTH_EXPIRED", "CONTENT_REJECTED"].includes(error.code) &&
            attempt < 5;
          const seconds = Math.max(
            [60, 240, 900, 3600][attempt - 1] ?? 3600,
            error.retryAfterSeconds ?? 0,
          );
          await tx
            .update(postTargets)
            .set({
              status: uncertain ? "needs_review" : retry ? "queued" : "failed",
              lastErrorCode: error.code,
              lastErrorHuman: uncertain ? TELEGRAM_REVIEW : error.humanMessage,
              nextAttemptAt: retry
                ? new Date(Date.now() + seconds * 1000)
                : null,
              updatedAt: new Date(),
            })
            .where(eq(postTargets.id, t.id));
          if (error.code === "AUTH_EXPIRED")
            await tx
              .update(channels)
              .set({ status: "token_expired" })
              .where(eq(channels.id, c.id));
          await tx.insert(postEvents).values({
            postId: p.id,
            targetId: t.id,
            type: uncertain ? "needs_review" : retry ? "retry_scheduled" : "failed",
            message: uncertain ? TELEGRAM_REVIEW : `Attempt ${attempt} failed: ${error.humanMessage}${retry ? ` Retrying in ${Math.ceil(seconds / 60)} min.` : ""}`,
          });
        }
        // needs_review is per target and may leave the aggregate status unchanged.
        if (error && c.provider === "telegram" && ["NETWORK", "PROVIDER_DOWN", "UNKNOWN"].includes(error.code))
          await emit(tx, p.id, "post.needs_review", {target_id: t.id});
        await derivePostStatus(tx, p.id);
      });
    }),
  );
  return { claimed: claimed.length };
}
