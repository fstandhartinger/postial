import { deleteFixtureUsers } from './fixture-cleanup';
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
  subscriptions,
} from "../db/schema";
import { ensureWorkspace } from "../lib/workspaces";
import { encryptCredentials, decryptCredentials } from "../lib/crypto";
import { registerPublisher, PublishError } from "../lib/publishers";
import { tick, derivePostStatus } from "../lib/publishing";
import { workspaceEntitlements } from '../lib/entitlements';
import { localDateTime } from "../lib/timezone";
async function main() {
  const db = getDb(),
    userId = crypto.randomUUID();
  let behavior = "success",
    calls = 0;
  registerPublisher({
    provider: "mastodon",
    maxMediaBytes: 16000000, maxTextLength: 500,
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
        warnings: behavior === "warning" ? ["Missing image; add it manually."] : [],
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
    await db.insert(subscriptions).values({ workspaceId: workspace.id, status: "active", currentPeriodEnd: new Date(Date.now() + 86400000), stripeSubscriptionId: "fixture-" + userId });
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
    const liveLease = await fixture();
    await db.update(postTargets).set({ status: "publishing", attempts: 1, updatedAt: new Date(Date.now() - 660000), attemptStartedAt: new Date() }).where(eq(postTargets.id, liveLease.targets[0].id));
    const leaseCalls = calls; await tick(); assert.equal(calls, leaseCalls);
    assert.equal((await db.select().from(postTargets).where(eq(postTargets.id, liveLease.targets[0].id)))[0].status, "publishing");
    await db.update(postTargets).set({ status: "skipped" }).where(eq(postTargets.id, liveLease.targets[0].id));
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
    behavior = "warning";
    const warned = await fixture(); await tick();
    const readTarget = async (id: string) => (await db.select().from(postTargets).where(eq(postTargets.id, id)))[0];
    assert.deepEqual((await readTarget(warned.targets[0].id)).warnings, ["Missing image; add it manually."]);
    assert((await db.select().from(postEvents).where(eq(postEvents.postId, warned.post.id))).some(e => e.message.includes("with a warning: Missing image")));
    behavior = "success";
    for (const status of ["canceled", "trialing"]) {
      await db.update(subscriptions).set({ status, trialEnd: new Date(0) }).where(eq(subscriptions.workspaceId, workspace.id));
      const paused = await fixture(); const pausedCalls: number = calls; await tick();
      assert.equal(calls, pausedCalls); assert.equal((await readTarget(paused.targets[0].id)).status, "held");
      await db.update(subscriptions).set({ status: "active" }).where(eq(subscriptions.workspaceId, workspace.id));
      await tick(); assert.equal((await readTarget(paused.targets[0].id)).status, "published");
    }
    const exhausted = await fixture();
    await db.update(postTargets).set({ status: "publishing", attempts: 8, attemptStartedAt: new Date(Date.now() - 660000) }).where(eq(postTargets.id, exhausted.targets[0].id));
    const exhaustedCalls = calls; await tick(); assert.equal(calls, exhaustedCalls); assert.equal((await readTarget(exhausted.targets[0].id)).status, "failed");
    const skipped = await fixture(2);
    await db.update(postTargets).set({ status: "skipped" }).where(eq(postTargets.postId, skipped.post.id));
    await db.transaction(tx => derivePostStatus(tx, skipped.post.id));
    assert.equal((await db.select().from(posts).where(eq(posts.id, skipped.post.id)))[0].status, "skipped");
    await db.update(postTargets).set({ status: "published" }).where(eq(postTargets.id, skipped.targets[0].id));
    await db.transaction(tx => derivePostStatus(tx, skipped.post.id));
    assert.equal((await db.select().from(posts).where(eq(posts.id, skipped.post.id)))[0].status, "published");
    // Agency downgrade: only the oldest three brands remain writable/publishable.
    await db.update(subscriptions).set({ plan: "agency" }).where(eq(subscriptions.workspaceId, workspace.id));
    for (let i = 0; i < 3; i++) await db.insert(brands).values({ workspaceId: workspace.id, name: `Extra ${i}`, slug: `extra-${i}`, createdAt: new Date(Date.now() + i * 1000) });
    assert.equal((await workspaceEntitlements(workspace)).activeBrandIds.length, 4);
    await db.update(subscriptions).set({ plan: "starter" }).where(eq(subscriptions.workspaceId, workspace.id));
    const access = await workspaceEntitlements(workspace);
    assert.equal(access.activeBrandIds.length, 3); assert(access.activeBrandIds.includes(brand.id));
    const extra = (await db.select().from(brands).where(eq(brands.workspaceId, workspace.id))).find(b => !access.activeBrandIds.includes(b.id))!;
    const extraPost = await fixture();
    await db.update(posts).set({ brandId: extra.id }).where(eq(posts.id, extraPost.post.id));
    const downgradeCalls = calls; await tick(); assert.equal(calls, downgradeCalls);
    assert.equal((await readTarget(extraPost.targets[0].id)).status, "held");
    await db.update(subscriptions).set({ plan: "agency" }).where(eq(subscriptions.workspaceId, workspace.id));
    await tick(); assert.equal((await readTarget(extraPost.targets[0].id)).status, "published");
    console.log("PASS: Agency downgrade keeps oldest brands active and holds excess brand jobs until upgrade");
    // Inject an outcome-commit outage after the fake remote has accepted the post.
    const originalTransaction = db.transaction.bind(db);
    for (const provider of ["mastodon", "telegram", "bluesky"] as const) {
      let remoteCalls = 0; const remoteKeys = new Set<string>(); let failCommit = true;
      registerPublisher({ provider, maxMediaBytes: 16000000, maxTextLength: 500, credentialFields: [], async validate() { return { externalId: "fixture", displayName: "fixture" }; }, async publish(_c, input) {
        remoteCalls++; remoteKeys.add(input.idempotencyKey);
        if (failCommit) db.transaction = (async () => { throw new Error("Injected result commit failure"); }) as typeof db.transaction;
        return { remoteId: input.idempotencyKey };
      } });
      const uncertain = await fixture();
      await db.update(channels).set({ provider }).where(eq(channels.id, cs[0].id));
      try { await assert.rejects(tick()); } finally { db.transaction = originalTransaction; failCommit = false; }
      assert.equal((await readTarget(uncertain.targets[0].id)).status, "publishing");
      await db.update(postTargets).set({ attemptStartedAt: new Date(Date.now() - 660000) }).where(eq(postTargets.id, uncertain.targets[0].id));
      await tick(); await tick();
      assert.equal((await readTarget(uncertain.targets[0].id)).status, provider === "telegram" ? "needs_review" : "published");
      assert.equal(remoteCalls, provider === "telegram" ? 1 : 2); assert.equal(remoteKeys.size, 1);
    }
    console.log("PASS: persisted warnings/history, canceled subscription and expired trial hold/resume, recovery budget, skipped aggregation, commit outage: stable Mastodon/Bluesky key and Telegram manual review");
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
    await deleteFixtureUsers(db).where(eq(users.id, userId));
    await db.$client.end();
  }
}
main().catch((error) => {
  console.error("Core verification failed", error.name, error.code, error instanceof assert.AssertionError ? error.message : "", String(error.stack).split("\n").filter(line => line.includes(".ts:")).join("\n"));
  process.exitCode = 1;
});
