import { and, eq, inArray, lte, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { channels, posts, postTargets, postEvents } from "@/db/schema";
import { decryptCredentials } from "@/lib/crypto";
import { getPublisher, PublishError } from "@/lib/publishers";
type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];
export async function derivePostStatus(tx: Tx, postId: string) {
  await tx
    .select({ id: posts.id })
    .from(posts)
    .where(eq(posts.id, postId))
    .for("no key update");
  const rows = await tx
    .select()
    .from(postTargets)
    .where(eq(postTargets.postId, postId));
  if (!rows.length) return;
  const status = rows.some((r) => r.status === "publishing")
    ? "publishing"
    : rows.some((r) => r.status === "queued")
      ? "scheduled"
      : rows.every((r) => r.status === "published")
        ? "published"
        : rows.some((r) => r.status === "published")
          ? "partially_failed"
          : "failed";
  await tx
    .update(posts)
    .set({ status, updatedAt: new Date() })
    .where(eq(posts.id, postId));
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
      .select()
      .from(postTargets)
      .where(
        and(
          eq(postTargets.status, "publishing"),
          lte(postTargets.updatedAt, new Date(Date.now() - 600000)),
        ),
      )
      .for("update", { skipLocked: true })
      .limit(10);
    for (const t of abandoned) {
      await tx
        .update(postTargets)
        .set({
          status: "queued",
          nextAttemptAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(postTargets.id, t.id));
      await tx.insert(postEvents).values({
        postId: t.postId,
        targetId: t.id,
        type: "recovered",
        message: "Recovering interrupted attempt",
      });
    }
  });
  const claimed = await db.transaction(async (tx) => {
    const rows = await tx
      .select({ target: postTargets, post: posts, channel: channels })
      .from(postTargets)
      .innerJoin(posts, eq(posts.id, postTargets.postId))
      .innerJoin(channels, eq(channels.id, postTargets.channelId))
      .where(
        and(
          eq(postTargets.status, "queued"),
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
            message: `Published to ${c.displayName}`,
          });
        } else if (error) {
          const retry =
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
              status: retry ? "queued" : "failed",
              lastErrorCode: error.code,
              lastErrorHuman: error.humanMessage,
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
            type: retry ? "retry_scheduled" : "failed",
            message: `Attempt ${attempt} failed: ${error.humanMessage}${retry ? ` Retrying in ${Math.ceil(seconds / 60)} min.` : ""}`,
          });
        }
        await derivePostStatus(tx, p.id);
      });
    }),
  );
  return { claimed: claimed.length };
}
