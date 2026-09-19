import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../db/schema';
import { assertVerificationDatabase, createIsolatedDatabase, migrateVerificationDatabase } from './isolated-db.mjs';
import { getDb } from '../db';
import { users, workspaces, brands, channels, posts, postTargets, postMetrics } from '../db/schema';
import { encryptCredentials } from '../lib/crypto';
import { getPublisher, registerPublisher } from '../lib/publishers';
import { METRICS_TICK_LOCK_KEY, refreshMetricsTick } from '../lib/metrics/refresh';

async function bounded<T>(operation: PromiseLike<T>, label: string, signal?: AbortSignal): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  try {
    signal?.throwIfAborted();
    return await Promise.race([operation, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new assert.AssertionError({ message: `${label} exceeded 5000ms` })), 5000);
      abort = () => reject(new Error('Verification interrupted'));
      signal?.addEventListener('abort', abort, { once: true });
    })]);
  } finally {
    clearTimeout(timer);
    if (abort) signal?.removeEventListener('abort', abort);
  }
}

async function main() {
  const controller = new AbortController();
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
    process.exitCode = signal === 'SIGINT' ? 130 : 143;
    controller.abort();
  });
  const options = { signal: controller.signal, migrate: migrateVerificationDatabase };
  const isolated = process.env.VERIFY_ADMIN_DATABASE_URL
    ? await createIsolatedDatabase(undefined, options)
    : null;
  let db: ReturnType<typeof getDb> | undefined;
  const originalFetch = globalThis.fetch;
  const originalPublisher = getPublisher('mastodon');
  const originalKey = process.env.APP_ENCRYPTION_KEY;
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const userId = randomUUID();
  let workspaceId: string | undefined;
  const calls: string[] = [];
  try {
    if (isolated) process.env.DATABASE_URL = isolated.url;
    assertVerificationDatabase();
    process.env.APP_ENCRYPTION_KEY = randomBytes(32).toString('base64');
    globalThis.fetch = async () => { throw new Error('External HTTP forbidden in fairness regression'); };
    registerPublisher({
      ...originalPublisher,
      async fetchMetrics(_credentials, remoteId) {
        calls.push(remoteId);
        return { likes: 7, replies: 0, reposts: null, quotes: null, impressions: null };
      },
    });
    db = getDb();
    await db.insert(users).values({ id: userId, name: 'Metrics fairness fixture' });
    const [workspace] = await db.insert(workspaces).values({ ownerUserId: userId, name: 'Fixture', slug: userId }).returning();
    workspaceId = workspace.id;
    const [brand] = await db.insert(brands).values({ workspaceId: workspace.id, name: 'Fixture', slug: 'fixture' }).returning();
    const [channel] = await db.insert(channels).values({ brandId: brand.id, provider: 'mastodon', displayName: 'Fixture', externalId: 'fixture', credentialsEnc: encryptCredentials({ accessToken: 'synthetic-fixture' }) }).returning();
    const now = new Date();
    const hour = 3_600_000;
    async function targets(count: number, publishedAt: Date, prefix: string) {
      const ids = Array.from({ length: count }, () => randomUUID());
      await db!.insert(posts).values(ids.map(id => ({ id, brandId: brand.id, body: 'Synthetic fixture', status: 'published' as const })));
      return db!.insert(postTargets).values(ids.map((postId, index) => ({ postId, channelId: channel.id, status: 'published' as const, publishedAt, remoteId: `${prefix}-${index}` }))).returning();
    }
    const newer = await targets(500, new Date(now.getTime() - hour), 'newer');
    await db.insert(postMetrics).values(newer.map(target => ({ targetId: target.id, provider: 'mastodon' as const, fetchedAt: now, outcome: 'ok' as const, likes: 1 })));
    const [older] = await targets(1, new Date(now.getTime() - 2 * hour), 'older');
    await refreshMetricsTick(db);
    const measured = await db.select().from(postMetrics).where(eq(postMetrics.targetId, older.id));
    assert.equal(measured.length, 1, 'older due target must receive stored measurement despite newest 500 in backoff');
    assert.equal(measured[0].likes, 7);
    assert.equal(measured[0].replies, 0);
    assert.equal(measured[0].impressions, null);
    assert.deepEqual(calls, ['older-0']);
    console.log('PASS: older unmeasured target progresses past 500 freshly measured targets');

    const tied = await targets(25, new Date(now.getTime() - 2 * hour), 'tied');
    const expected = [...tied].sort((a, b) => a.id.localeCompare(b.id)).map(target => target.remoteId);
    calls.length = 0;
    assert.equal(await refreshMetricsTick(db), 20);
    assert.deepEqual(calls, expected.slice(0, 20), 'tied candidates use deterministic target id ordering');
    assert.equal(await refreshMetricsTick(db), 5);
    assert.deepEqual(calls, expected, 'next tick advances beyond the call cap');
    calls.length = 0;
    assert.equal(await refreshMetricsTick(db), 0);
    assert.deepEqual(calls, []);
    console.log('PASS: stable tied ordering, cap 20, next-tick progress and backoff');

    const aged = await targets(1, new Date(now.getTime() - 2 * 24 * hour), 'aged');
    const settled = await targets(1, new Date(now.getTime() - 8 * 24 * hour), 'settled');
    await db.insert(postMetrics).values([
      { targetId: aged[0].id, provider: 'mastodon', fetchedAt: new Date(now.getTime() - 5 * hour), outcome: 'provider_error' },
      { targetId: settled[0].id, provider: 'mastodon', fetchedAt: new Date(now.getTime() - 23 * hour), outcome: 'auth_expired' },
    ]);
    await targets(1, new Date(now.getTime() - 31 * 24 * hour), 'outside');
    await targets(1, new Date(now.getTime() + hour), 'future');
    const [unpublished, noRemote, unsupported] = await targets(3, new Date(now.getTime() - hour), 'excluded');
    const [telegram] = await db.insert(channels).values({ brandId: brand.id, provider: 'telegram', displayName: 'Fixture', externalId: 'fixture', credentialsEnc: encryptCredentials({ botToken: 'synthetic-fixture' }) }).returning();
    await db.update(postTargets).set({ status: 'queued' }).where(eq(postTargets.id, unpublished.id));
    await db.update(postTargets).set({ remoteId: null }).where(eq(postTargets.id, noRemote.id));
    await db.update(postTargets).set({ channelId: telegram.id }).where(eq(postTargets.id, unsupported.id));
    const beforeStatuses = await db.select({ id: postTargets.id, status: postTargets.status }).from(postTargets).orderBy(postTargets.id);
    assert.equal(await refreshMetricsTick(db), 0);
    await db.update(postMetrics).set({ fetchedAt: new Date(now.getTime() - 7 * hour) }).where(eq(postMetrics.targetId, aged[0].id));
    await db.update(postMetrics).set({ fetchedAt: new Date(now.getTime() - 25 * hour) }).where(eq(postMetrics.targetId, settled[0].id));
    assert.equal(await refreshMetricsTick(db), 2);
    assert.deepEqual(calls, ['settled-0', 'aged-0'], 'oldest prior attempt goes first');
    const statuses = await db.select({ id: postTargets.id, status: postTargets.status }).from(postTargets).orderBy(postTargets.id);
    assert.deepEqual(statuses, beforeStatuses);
    console.log('PASS: age and failed-outcome backoff, window/status/remote/network filters, prior-attempt order, unchanged publish status');
    const malformed = ['synthetic-malformed-ciphertext', 'v1:k0:invalid', encryptCredentials({ accessToken: 'synthetic-fixture' }).replace(/:[^:]+$/, ':' + Buffer.alloc(16).toString('base64'))];
    const badChannels = await db.insert(channels).values(malformed.map((credentialsEnc, index) => ({ brandId: brand.id, provider: 'mastodon' as const, displayName: 'Malformed fixture', externalId: `bad-${index}`, credentialsEnc }))).returning();
    const bad = await targets(20, new Date(now.getTime() - 4 * hour), 'malformed');
    for (let index = 0; index < bad.length; index++) await db.update(postTargets).set({ channelId: badChannels[index % badChannels.length].id }).where(eq(postTargets.id, bad[index].id));
    const [healthy] = await targets(1, new Date(now.getTime() - 3 * hour), 'healthy');
    const beforeTargets = await db.select().from(postTargets).orderBy(postTargets.id);
    const beforePosts = await db.select().from(posts).orderBy(posts.id);
    const beforeChannels = await db.select().from(channels).orderBy(channels.id);
    calls.length = 0;
    const attemptedAt = Date.now();
    assert.equal(await refreshMetricsTick(db), 20);
    assert.equal(calls.length, 0, '20 malformed targets sort before the healthy target and make no provider calls');
    const attempts = await db.select().from(postMetrics);
    const failures = attempts.filter(row => bad.some(target => target.id === row.targetId));
    assert.equal(failures.length, 20, 'every malformed credential must record an attempt for backoff');
    for (const row of failures) {
      assert.equal(row.outcome, 'provider_error');
      assert(row.fetchedAt.getTime() >= attemptedAt && row.fetchedAt.getTime() <= Date.now());
      for (const key of ['likes', 'replies', 'reposts', 'quotes', 'impressions'] as const) assert.equal(row[key], null);
    }
    assert.equal(await refreshMetricsTick(db), 1);
    assert.deepEqual(calls, ['healthy-0'], 'healthy target progresses on next tick past 20 malformed credentials');
    assert.equal((await db.select().from(postMetrics).where(eq(postMetrics.targetId, healthy.id)))[0].likes, 7);
    assert.equal(await refreshMetricsTick(db), 0, 'failed attempts and healthy measurement respect backoff');
    assert.deepEqual(await db.select().from(postTargets).orderBy(postTargets.id), beforeTargets);
    assert.deepEqual(await db.select().from(posts).orderBy(posts.id), beforePosts);
    assert.deepEqual(await db.select().from(channels).orderBy(channels.id), beforeChannels);
    console.log('PASS: 20 malformed encrypted credentials record null failures, back off, preserve publishing/channels and allow next-tick healthy progress');
    const raced = await targets(7, new Date(now.getTime() - 2 * hour), 'race');
    const raceCalls: string[] = [];
    const contenderClient = postgres(process.env.DATABASE_URL!, {
      prepare: false, max: 1, connect_timeout: 2, connection: { statement_timeout: 4000 },
    });
    const contenderDb = drizzle(contenderClient, { schema });
    let enter!: () => void;
    let release!: () => void;
    let released = false;
    let providerExited = false;
    let firstSettled = false;
    const entered = new Promise<void>(resolve => { enter = resolve; });
    const held = new Promise<void>(resolve => { release = () => { released = true; resolve(); }; });
    let first: Promise<number> | undefined;
    let second: Promise<number> | undefined;
    registerPublisher({
      ...originalPublisher,
      async fetchMetrics(_credentials, remoteId) {
        raceCalls.push(remoteId);
        if (raceCalls.length === 1) {
          enter();
          await held;
          providerExited = true;
        }
        return { likes: 7, replies: 0, reposts: null, quotes: null, impressions: null };
      },
    });
    try {
      const [connection] = await bounded(contenderClient`select pg_backend_pid() as pid`, 'contender connection ready', controller.signal);
      first = refreshMetricsTick(db).finally(() => { firstSettled = true; });
      void first.catch(() => {});
      await bounded(Promise.race([entered, first.then(() => { assert.fail('first tick completed before provider entry'); })]), 'first provider entry', controller.signal);
      const locks = await bounded(contenderClient`select pid from pg_locks where locktype = 'advisory' and granted
        and database = (select oid from pg_database where datname = current_database())
        and classid = 0 and objid = ${METRICS_TICK_LOCK_KEY} and objsubid = 1`, 'first advisory lock observation', controller.signal);
      assert.equal(locks.length, 1, 'first tick must hold the actual advisory lock at provider entry');
      assert.notEqual(locks[0].pid, connection.pid, 'contender is a separate available PostgreSQL session');
      assert.equal(firstSettled, false);
      assert.equal(providerExited, false);
      assert.equal(released, false);
      assert.equal(raceCalls.length, 1);
      second = refreshMetricsTick(contenderDb);
      void second.catch(() => {});
      assert.equal(await bounded(second, 'second tick while first provider is held', controller.signal), 0, 'second tick must return zero BEFORE first release');
      assert.equal(firstSettled, false, 'first tick must still be blocked when second completes');
      assert.equal(providerExited, false);
      assert.equal(released, false);
      assert.equal(raceCalls.length, 1, 'second tick must not enter the provider');
      const beforeRelease = await bounded(contenderDb.select().from(postMetrics).where(inArray(postMetrics.targetId, raced.map(target => target.id))), 'rows before release', controller.signal);
      assert.deepEqual(beforeRelease, [], 'no metric row may be committed before provider release');
      release();
      assert.equal(await bounded(first, 'first tick after release', controller.signal), 7);
      const raceRows = await bounded(contenderDb.select().from(postMetrics).where(inArray(postMetrics.targetId, raced.map(target => target.id))), 'stored race rows', controller.signal);
      assert.equal(raceRows.length, 7, 'exactly one stored measurement per raced target, no duplicate concurrent writes');
      for (const row of raceRows) {
        assert.equal(row.outcome, 'ok');
        assert.equal(row.likes, 7);
        assert.equal(row.replies, 0);
      }
      assert.deepEqual(raceRows.map(row => row.targetId).sort(), raced.map(target => target.id).sort());
      assert.deepEqual([...raceCalls].sort(), raced.map(target => target.remoteId).sort(), 'each raced target fetched exactly once across both ticks');
      assert.equal(await bounded(refreshMetricsTick(contenderDb), 'race backoff', controller.signal), 0, 'raced targets are within backoff on the following tick');
      assert.equal(raceCalls.length, 7, 'backoff must not make further provider calls');
      console.log('PASS: provider-entry barrier holds first lock; independent second connection returns zero before release; seven successful unique measurements and backoff');
    } finally {
      release();
      try {
        await bounded(Promise.allSettled([first, second].filter((tick): tick is Promise<number> => tick !== undefined)), 'settle overlapping ticks');
      } finally {
        await contenderClient.end({ timeout: 5 });
      }
    }
  } finally {
    globalThis.fetch = originalFetch;
    registerPublisher(originalPublisher);
    if (originalKey === undefined) delete process.env.APP_ENCRYPTION_KEY;
    else process.env.APP_ENCRYPTION_KEY = originalKey;
    try {
      if (db) {
        if (workspaceId) await bounded(db.delete(workspaces).where(eq(workspaces.id, workspaceId)), 'delete fixture workspace');
        await bounded(db.delete(users).where(eq(users.id, userId)), 'delete fixture user');
      }
    } finally {
      try { await db?.$client.end({ timeout: 5 }); }
      finally {
        try { await isolated?.cleanup(); }
        finally {
          if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
          else process.env.DATABASE_URL = originalDatabaseUrl;
        }
      }
    }
    console.log('CLEANUP: fixture connection closed and owned isolated database/role removed when provisioned');
  }
}
main().catch(error => {
  console.error('FAIL metrics fairness:', error instanceof assert.AssertionError ? error.message : 'setup or database operation failed');
  process.exitCode ||= 1;
});
