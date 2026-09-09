import { workerState } from './state';
import { checkChannelHealth } from "./health";
import { mediaRetentionTick } from "@/lib/media/retention";
import { notifyWorkspace } from '@/lib/notifications';
import { emit, emitPublishing } from "@/lib/api/webhooks";
import { workspaceEntitlements } from '@/lib/entitlements';
function uncertainProvider(provider: string) { return ['telegram', 'x', 'threads', 'linkedin'].includes(provider); }
function reviewMessage(provider: string) { return provider === 'telegram' ? TELEGRAM_REVIEW : `We couldn't confirm whether ${provider === 'x' ? 'X' : provider === 'threads' ? 'Threads' : 'LinkedIn'} received this post. Check the account, then retry or skip.`; }
export const TELEGRAM_REVIEW = "We couldn't confirm whether Telegram received this post. Check the channel, then retry or skip.";
export const UNKNOWN_FAILED_MESSAGE = "Unexpected error while publishing. Our team has been notified; you can retry manually.";
import { and, eq, inArray, lte, lt, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { brands, channels, posts, postTargets, postEvents } from "@/db/schema";
import { decryptCredentials, encryptCredentials } from "@/lib/crypto";
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
      const status = t.attempts >= 5 ? "failed" : uncertainProvider(channel.provider) ? "needs_review" : "queued";
      const message = uncertainProvider(channel.provider) ? reviewMessage(channel.provider) : status === "failed" ? "Attempt limit reached. Check the remote account before retrying." : "Recovering interrupted attempt using provider idempotency";
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
  const held = await db.select({ target: postTargets, workspaceId: brands.workspaceId, brandId: brands.id, scheduledAt: posts.scheduledAt }).from(postTargets)
    .innerJoin(posts, eq(posts.id, postTargets.postId)).innerJoin(brands, eq(brands.id, posts.brandId))
    .where(and(eq(postTargets.status, "held"), inArray(posts.status, ["scheduled", "approved", "publishing"]), lt(postTargets.attempts, 5)));
  for (const workspaceId of [...new Set(held.map(r => r.workspaceId))]) {
    const access = await workspaceEntitlements(workspaceId);
    if (!access.publish) continue;
    for (const row of held.filter(r => r.workspaceId === workspaceId && access.activeBrandIds.includes(r.brandId))) {
      await db.update(postTargets).set({ status: "queued", nextAttemptAt: row.scheduledAt && row.scheduledAt.getTime() > Date.now() ? row.scheduledAt : new Date(), updatedAt: new Date() }).where(and(eq(postTargets.id, row.target.id), eq(postTargets.status, "held")));
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
      .for("update", { of: [posts, postTargets], skipLocked: true })
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
          if (changed.length) await notifyWorkspace(tx,brand.workspaceId,"held",p.id);
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
        const publisher = getPublisher(c.provider);
        let credentials = decryptCredentials(c.credentialsEnc);
        if (publisher.refreshCredentials) credentials = await db.transaction(async tx => {
          // Serialize rotating refresh tokens across processes and re-read after waiting.
          const [current] = await tx.select().from(channels).where(eq(channels.id, c.id)).for('update');
          if (!current || current.status !== 'active') throw new PublishError({ code: 'AUTH_EXPIRED', retryable: false, humanMessage: 'Reconnect this channel.' });
          c.credentialsEnc = current.credentialsEnc;
          const stored = decryptCredentials(current.credentialsEnc);
          const renewed = await publisher.refreshCredentials!(stored);
          if (renewed) {
            c.credentialsEnc = encryptCredentials(renewed);
            await tx.update(channels).set({ credentialsEnc: c.credentialsEnc, lastCheckedAt: new Date() }).where(eq(channels.id, c.id));
          }
          return renewed ?? stored;
        });
        result = await publisher.publish(
          credentials,
          {
            text: p.body,
            mediaUrls: p.mediaUrls,
            mediaAlt: p.mediaAlt,
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
          const uncertain = uncertainProvider(c.provider) && ["NETWORK", "PROVIDER_DOWN", "UNKNOWN"].includes(error.code);
          // Unexpected provider errors (UNKNOWN) fail after 3 attempts, others after 5.
          const attemptLimit = error.code === "UNKNOWN" ? 3 : 5;
          const retry = !uncertain &&
            error.retryable &&
            !["AUTH_EXPIRED", "CONTENT_REJECTED"].includes(error.code) &&
            attempt < attemptLimit;
          const failureHuman = error.code === "UNKNOWN" ? UNKNOWN_FAILED_MESSAGE : error.humanMessage;
          const seconds = Math.max(
            [60, 240, 900, 3600][attempt - 1] ?? 3600,
            error.retryAfterSeconds ?? 0,
          );
          await tx
            .update(postTargets)
            .set({
              status: uncertain ? "needs_review" : retry ? "queued" : "failed",
              lastErrorCode: error.code,
              lastErrorHuman: uncertain ? reviewMessage(c.provider) : retry ? error.humanMessage : failureHuman,
              nextAttemptAt: retry
                ? new Date(Date.now() + seconds * 1000)
                : null,
              updatedAt: new Date(),
            })
            .where(eq(postTargets.id, t.id));
          if (error.code === "AUTH_EXPIRED") await notifyWorkspace(tx,brand.workspaceId,"token_expired",p.id);
          if (error.code === "AUTH_EXPIRED")
            await tx
              .update(channels)
              .set({ status: "token_expired", lastCheckedAt: new Date() })
              .where(and(eq(channels.id, c.id), eq(channels.status, "active"), eq(channels.credentialsEnc, c.credentialsEnc)));
          await tx.insert(postEvents).values({
            postId: p.id,
            targetId: t.id,
            type: uncertain ? "needs_review" : retry ? "retry_scheduled" : "failed",
            message: uncertain ? reviewMessage(c.provider) : `Attempt ${attempt} failed: ${retry ? error.humanMessage : failureHuman}${retry ? ` Retrying in ${Math.ceil(seconds / 60)} min.` : ""}`,
          });
        }
        // needs_review is per target and may leave the aggregate status unchanged.
        if (error && uncertainProvider(c.provider) && ["NETWORK", "PROVIDER_DOWN", "UNKNOWN"].includes(error.code))
          await emit(tx, p.id, "post.needs_review", {target_id: t.id});
        await derivePostStatus(tx, p.id);
      });
    }),
  );
  await checkChannelHealth().catch(() => console.error("Channel health tick failed"));
  await mediaRetentionTick().catch(() => console.error("Media retention tick failed"));
  workerState.lastTickAt = new Date().toISOString();
  return { claimed: claimed.length };
}
