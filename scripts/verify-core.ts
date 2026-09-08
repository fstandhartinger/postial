import assert from "node:assert/strict";
import { eq, and } from "drizzle-orm";
import { getDb } from "../db";
import {
  users,
  brands,
  channels,
  posts,
  postTargets,
  postEvents,
  sessions,
} from "../db/schema";
import { ensureWorkspace } from "../lib/workspaces";
import { encryptCredentials, decryptCredentials } from "../lib/crypto";
import { registerPublisher, PublishError } from "../lib/publishers";
import { tick } from "../lib/publishing";
import { localDateTime } from "../lib/timezone";
async function main() {
  const db = getDb(),
    userId = crypto.randomUUID();
  let behavior = "success",
    calls = 0;
  registerPublisher({
    provider: "mastodon",
    maxTextLength: 500,
    credentialFields: [],
    async validate() {
      return { externalId: "fake", displayName: "Fake" };
    },
    async publish(_credentials, input) {
      calls++;
      if (behavior === "rate")
        throw new PublishError({
          code: "RATE_LIMITED",
          retryable: true,
          humanMessage: "Rate limit reached.",
          retryAfterSeconds: 120,
        });
      if (behavior === "auth")
        throw new PublishError({
          code: "AUTH_EXPIRED",
          retryable: false,
          humanMessage: "Reconnect your account.",
        });
      return {
        remoteId: input.idempotencyKey,
        url: "https://example.com/post",
      };
    },
  });
  try {
    const secret = { token: "synthetic-fixture" };
    const enc = encryptCredentials(secret);
    assert(!enc.includes(secret.token));
    assert.deepEqual(decryptCredentials(enc), secret);
    assert.throws(() => decryptCredentials(enc.slice(0, -4) + "AAAA"));
    assert.equal(
      localDateTime("2026-09-10T09:00", "Europe/Berlin").toISOString(),
      "2026-09-10T07:00:00.000Z",
    );
    assert.throws(() => localDateTime("2026-03-29T02:30", "Europe/Berlin"));
    assert.throws(() => localDateTime("2026-10-25T02:30", "Europe/Berlin"));
    await db.insert(users).values({ id: userId, name: "Core fixture" });
    const workspace = await ensureWorkspace(userId);
    const [brand] = await db
      .insert(brands)
      .values({ workspaceId: workspace.id, name: "Fixture", slug: "fixture" })
      .returning();
    const cs = await db
      .insert(channels)
      .values(
        [1, 2].map((n) => ({
          brandId: brand.id,
          provider: "mastodon" as const,
          displayName: `Fake ${n}`,
          externalId: `fake-${n}`,
          credentialsEnc: enc,
        })),
      )
      .returning();
    async function fixture(
      count = 1,
      status: "scheduled" | "pending_approval" | "approved" = "scheduled",
    ) {
      const [post] = await db
        .insert(posts)
        .values({
          brandId: brand.id,
          authorUserId: userId,
          body: "Fixture",
          status,
          requiresApproval: status !== "scheduled",
          approvalToken: status !== "scheduled" ? crypto.randomUUID() : null,
          scheduledAt: new Date(Date.now() - 1000),
        })
        .returning();
      const targets = await db
        .insert(postTargets)
        .values(
          cs
            .slice(0, count)
            .map((c) => ({
              postId: post.id,
              channelId: c.id,
              nextAttemptAt:
                status === "scheduled" ? new Date(Date.now() - 1000) : null,
            })),
        )
        .returning();
      return { post, targets };
    }
    const success = await fixture(2);
    await Promise.all([tick(), tick()]);
    assert.equal(calls, 2);
    assert.equal(
      (await db.select().from(posts).where(eq(posts.id, success.post.id)))[0]
        .status,
      "published",
    );
    assert.equal(
      (
        await db
          .select()
          .from(postEvents)
          .where(
            and(
              eq(postEvents.postId, success.post.id),
              eq(postEvents.type, "published"),
            ),
          )
      ).length,
      2,
    );
    behavior = "rate";
    const rate = await fixture();
    await tick();
    const [limited] = await db
      .select()
      .from(postTargets)
      .where(eq(postTargets.id, rate.targets[0].id));
    assert.equal(limited.status, "queued");
    assert.equal(limited.attempts, 1);
    assert(limited.nextAttemptAt!.getTime() > Date.now() + 110000);
    behavior = "auth";
    const auth = await fixture();
    await tick();
    assert.equal(
      (
        await db
          .select()
          .from(postTargets)
          .where(eq(postTargets.id, auth.targets[0].id))
      )[0].status,
      "failed",
    );
    assert.equal(
      (await db.select().from(channels).where(eq(channels.id, cs[0].id)))[0]
        .status,
      "token_expired",
    );
    await db
      .update(channels)
      .set({ status: "active" })
      .where(eq(channels.id, cs[0].id));
    behavior = "success";
    const orphan = await fixture();
    await db
      .update(postTargets)
      .set({
        status: "publishing",
        attempts: 1,
        updatedAt: new Date(Date.now() - 660000),
      })
      .where(eq(postTargets.id, orphan.targets[0].id));
    await tick();
    assert.equal(
      (
        await db
          .select()
          .from(postTargets)
          .where(eq(postTargets.id, orphan.targets[0].id))
      )[0].status,
      "published",
    );
    assert.equal(
      (
        await db
          .select()
          .from(postEvents)
          .where(
            and(
              eq(postEvents.postId, orphan.post.id),
              eq(postEvents.type, "recovered"),
            ),
          )
      ).length,
      1,
    );
    const held = await fixture(1, "pending_approval");
    const before = calls;
    await tick();
    assert.equal(calls, before);
    await db
      .update(posts)
      .set({ status: "approved" })
      .where(eq(posts.id, held.post.id));
    await tick();
    assert.equal(
      (await db.select().from(posts).where(eq(posts.id, held.post.id)))[0]
        .status,
      "published",
    );
    behavior = "rate";
    await db
      .update(postTargets)
      .set({ attempts: 4, nextAttemptAt: new Date(Date.now() - 1000) })
      .where(eq(postTargets.id, limited.id));
    await tick();
    assert.equal(
      (
        await db
          .select()
          .from(postTargets)
          .where(eq(postTargets.id, limited.id))
      )[0].status,
      "failed",
    );
    console.log(
      "PASS: encryption integrity, timezone/DST, concurrent claims, two-target success/events, rate limit/backoff, auth expiry, orphan recovery, approval hold/release, five-attempt limit",
    );
    if (process.env.CORE_HTTP_URL) {
      const base = process.env.CORE_HTTP_URL,
        token = crypto.randomUUID();
      await db
        .insert(sessions)
        .values({
          sessionToken: token,
          userId,
          expires: new Date(Date.now() + 60000),
        });
      for (const path of [
        "/app",
        "/app/brands",
        "/app/posts/new",
        "/app/calendar",
      ]) {
        assert.equal(
          (await fetch(base + path, { redirect: "manual" })).status,
          307,
          path + " anonymous",
        );
        assert.equal(
          (
            await fetch(base + path, {
              redirect: "manual",
              headers: { cookie: `authjs.session-token=${token}` },
            })
          ).status,
          200,
          path + " authenticated",
        );
      }
      assert.equal(
        (await fetch(base + "/api/internal/tick", { method: "POST" })).status,
        401,
      );
      console.log(
        "PASS: authenticated pages 200, anonymous pages 307, internal tick without secret 401",
      );
    }
  } finally {
    await db.delete(users).where(eq(users.id, userId));
    await db.$client.end();
  }
}
main().catch(() => {
  console.error("Core verification failed");
  process.exitCode = 1;
});
