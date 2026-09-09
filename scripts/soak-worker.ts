/** Real-time, isolated PostgreSQL soak. No external publishing or login.
 * Run with DATABASE_URL pointing at the local DB (sslmode=require).
 * Creates/migrates/drops a unique database via local sudo -u postgres psql.
 * SOAK_SECONDS / SOAK_SCHEDULE_SECONDS permit a short harness smoke test.
 */
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import postgres from 'postgres';

const seconds = Number(process.env.SOAK_SECONDS ?? 1800);
const scheduleSeconds = Number(process.env.SOAK_SCHEDULE_SECONDS ?? 1200);
assert(Number.isFinite(seconds) && seconds > 0 && Number.isFinite(scheduleSeconds) && scheduleSeconds >= 0);
const reportDir = process.env.SOAK_REPORT_DIR ?? '/path/to/postial/work';
mkdirSync(reportDir, { recursive: true });
const dbName = 'socialmint_soak_' + randomUUID().replaceAll('-', '');
const quote = (v: string) => '"' + v.replaceAll('"', '""') + '"';
function admin(query: string) {
  const r = spawnSync('sudo', ['-n', '-u', 'postgres', 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-q'], { input: query, encoding: 'utf8' });
  assert.equal(r.status, 0, 'Local database administration failed (output suppressed)');
}
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const metrics = { database: dbName, seconds, scheduleSeconds, seed: 9, start: '', finish: '', targets: 0,
  outcomes: {} as Record<string, number>, tickMs: [[], []] as number[][], claimed: [0, 0],
  webhookTickMs: [[], []] as number[][], webhookClaimed: [0, 0], samples: [] as object[],
  errors: [] as string[], duplicateSuccess: 0, illegalRepeat: 0, retriesAfterUnknown: 0,
  recoveryInjected: 12, recovered: 0, received: 0, duplicateDeliveries: 0,
  statuses: {} as Record<string, number>, postStatuses: {} as Record<string, number>,
  outbox: [] as object[], cleanup: false, passed: false };
let seed = 9;
function rng() { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }
let deck: string[] = [];
function outcome() {
  if (!deck.length) {
    deck = [...Array(70).fill('success'), ...Array(15).fill('RATE_LIMITED'), ...Array(10).fill('NETWORK'), ...Array(4).fill('CONTENT_REJECTED'), 'UNKNOWN'];
    for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
  }
  return deck.pop()!;
}
const histories = new Map<string, string[]>(), deliveryIds = new Set<string>();
const originalError = console.error, originalWarn = console.warn;
console.error = () => { metrics.errors.push('console.error'); originalError('Soak: product console.error (details suppressed)'); };
console.warn = () => { metrics.errors.push('console.warn'); originalWarn('Soak: product console.warn (details suppressed)'); };
let created = false;
let closeDb: (() => Promise<void>) | undefined;
const receiver = createServer(async (req, res) => {
  for await (const chunk of req) { void chunk; }
  const id = String(req.headers['x-postial-delivery']);
  if (deliveryIds.has(id)) metrics.duplicateDeliveries++;
  deliveryIds.add(id); metrics.received++;
  res.writeHead(204); res.end();
});
async function main() {
  const url = new URL(process.env.DATABASE_URL!);
  assert(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'Soak requires local DB');
  const source = postgres(url.toString(), { max: 1, prepare: false });
  let role: string;
  try { [ { role } ] = await source<{ role: string }[]>`select current_user as role`; }
  finally { await source.end(); }
  admin(`CREATE DATABASE ${quote(dbName)} OWNER ${quote(role)};`); created = true;
  url.pathname = '/' + dbName;
  // The supplied local URL may use a database-allowlisted PgBouncer.
  url.port = process.env.SOAK_POSTGRES_PORT ?? '5432';
  url.searchParams.set('application_name', dbName);
  process.env.DATABASE_URL = url.toString();
  process.env.WEBHOOK_ALLOW_LOOPBACK = '1';
  process.env.WORKER_ENABLED = 'false';
  assert.notEqual(process.env.NODE_ENV, 'production');
  const migration = spawnSync(process.execPath, ['scripts/migrate.mjs'], { encoding: 'utf8', env: process.env });
  if (migration.status !== 0) {
    const diagnostic = postgres(url.toString(), {max:1, prepare:false});
    try {
      const { drizzle } = await import('drizzle-orm/postgres-js');
      const { migrate } = await import('drizzle-orm/postgres-js/migrator');
      await migrate(drizzle(diagnostic), {migrationsFolder:'./drizzle'});
    } catch (e) {
      const err = e as {code?:string; cause?:{code?:string; message?:string}};
      metrics.errors.push('Migration SQLSTATE: ' + (err.cause?.code ?? err.code ?? 'unknown'));
      if (err.cause?.message) metrics.errors.push(err.cause.message);
      throw new Error('Soak migration failed');
    } finally { await diagnostic.end(); }
  }
  const { getDb } = await import('../db');
  const { users, workspaces, subscriptions, brands, channels, posts, postTargets, postEvents, webhookEndpoints } = await import('../db/schema');
  const { eq, sql } = await import('drizzle-orm');
  const { encryptCredentials } = await import('../lib/crypto');
  const { registerPublisher, PublishError } = await import('../lib/publishers');
  const { tick } = await import('../lib/publishing');
  const { deliverWebhooks } = await import('../lib/api/webhooks');
  const { deleteFixtureUsers } = await import('./fixture-cleanup');
  const db = getDb(); closeDb = () => db.$client.end();
  registerPublisher({ provider: 'mastodon', maxMediaBytes: 16000000, maxTextLength: 500, credentialFields: [],
    async validate() { return { externalId: 'soak', displayName: 'Soak' }; },
    async publish(_c, input) {
      const h = histories.get(input.idempotencyKey) ?? [];
      if (h.includes('success')) metrics.duplicateSuccess++;
      if (h.length && !['RATE_LIMITED', 'NETWORK', 'UNKNOWN'].includes(h.at(-1)!)) metrics.illegalRepeat++;
      if (h.at(-1) === 'UNKNOWN') metrics.retriesAfterUnknown++;
      const o = outcome(); h.push(o); histories.set(input.idempotencyKey, h);
      metrics.outcomes[o] = (metrics.outcomes[o] ?? 0) + 1;
      const delay = 50 + Math.floor(rng() * 251), retryAfterSeconds = 2 + Math.floor(rng() * 4);
      await sleep(delay);
      if (o === 'UNKNOWN') throw new Error('Synthetic non-PublishError');
      if (o !== 'success') throw new PublishError({ code: o as 'RATE_LIMITED' | 'NETWORK' | 'CONTENT_REJECTED', retryable: o !== 'CONTENT_REJECTED', humanMessage: 'Synthetic soak failure', retryAfterSeconds: o === 'RATE_LIMITED' ? retryAfterSeconds : undefined });
      return { remoteId: input.idempotencyKey };
    } });
  const uid = randomUUID();
  await db.insert(users).values({ id: uid, name: 'Soak fixture' });
  try {
    const ws = await db.insert(workspaces).values(Array.from({ length: 20 }, (_, i) => ({ ownerUserId: uid, name: `Soak ${i}`, slug: `soak-${uid}-${i}` }))).returning();
    await db.insert(subscriptions).values(ws.map(w => ({ workspaceId: w.id, plan: 'agency' as const, status: 'active', currentPeriodEnd: new Date(Date.now() + 86400000), stripeSubscriptionId: 'fixture-' + w.id })));
    const [brand] = await db.insert(brands).values({ workspaceId: ws[0].id, name: 'Soak', slug: 'soak' }).returning();
    const cs = await db.insert(channels).values([0, 1, 2].map(i => ({ brandId: brand.id, provider: 'mastodon' as const, displayName: `Fake ${i}`, externalId: `soak-${i}`, credentialsEnc: encryptCredentials({ token: 'synthetic' }) }))).returning();
    receiver.listen(0, '127.0.0.1'); await once(receiver, 'listening');
    const address = receiver.address(); assert(address && typeof address !== 'string');
    const secret = 'synthetic-soak-signing-secret';
    await db.insert(webhookEndpoints).values(ws.flatMap(w => Array.from({ length: 10 }, (_, i) => ({ workspaceId: w.id, url: `http://127.0.0.1:${address.port}/${w.id}/${i}`, events: ['post.published', 'post.failed'], secretHash: createHash('sha256').update(secret).digest('hex'), secretEnc: encryptCredentials({ secret }) }))));
    // Seed one delivery per endpoint; primary workspace additionally receives actual publish events.
    await db.execute(sql`insert into webhook_deliveries(endpoint_id,event,payload) select id,'ping',jsonb_build_object('id',gen_random_uuid(),'event','ping') from webhook_endpoints`);
    const base = Date.now();
    const ps = await db.insert(posts).values(Array.from({ length: 1000 }, (_, i) => ({ brandId: brand.id, authorUserId: uid, body: `Soak ${i}`, status: 'scheduled' as const, scheduledAt: new Date(base + Math.floor(i / 999 * scheduleSeconds * 1000)) }))).returning();
    const ts = await db.insert(postTargets).values(ps.flatMap((p, i) => cs.slice(0, 1 + i % 3).map(c => ({ postId: p.id, channelId: c.id, nextAttemptAt: p.scheduledAt })))).returning();
    metrics.targets = ts.length;
    // Model twelve instances dying immediately after claim, before any remote call.
    // Real 10-minute lease expiry, no accelerated clock or shortened product backoff.
    const recoveryIds = ts.slice(0, 12).map(t => t.id);
    await db.execute(sql`update post_targets set status='publishing', attempts=1, attempt_started_at=now(), updated_at=now() where id in (${sql.join(recoveryIds.map(id => sql`${id}::uuid`), sql`,`)})`);
    metrics.start = new Date().toISOString();
    const end = Date.now() + seconds * 1000;
    async function loop(kind: 'worker' | 'outbox', instance: number) {
      while (Date.now() < end) {
        const start = performance.now();
        try {
          const result = await (kind === 'worker' ? tick() : deliverWebhooks());
          (kind === 'worker' ? metrics.claimed : metrics.webhookClaimed)[instance] += result.claimed;
        } catch (e) { metrics.errors.push(`${kind}-${instance}:${e instanceof Error ? e.name : 'error'}`); }
        (kind === 'worker' ? metrics.tickMs : metrics.webhookTickMs)[instance].push(performance.now() - start);
        await sleep(Math.max(0, Math.min(end - Date.now(), (kind === 'worker' ? 2000 : 1000) - (performance.now() - start))));
      }
    }
    async function sample() {
      while (Date.now() < end) {
        const [activity] = await db.execute(sql`select count(*)::int as connections,count(*) filter(where state='active')::int as active,count(*) filter(where state='idle in transaction')::int as idle_in_transaction from pg_stat_activity where datname=current_database()`);
        const [state] = await db.execute(sql`select count(*) filter(where status='publishing')::int as publishing,count(*) filter(where status='publishing' and attempt_started_at < now()-interval '10 minutes')::int as orphaned,count(*) filter(where status='published')::int as published from post_targets`);
        const s = { elapsed: Math.round((Date.now() - Date.parse(metrics.start)) / 1000), rssMiB: +(process.memoryUsage().rss / 1048576).toFixed(2), ...activity, ...state };
        metrics.samples.push(s); writeFileSync(reportDir + '/soak-progress.json', JSON.stringify({ ...metrics, tickMs: metrics.tickMs.map(a => a.length), webhookTickMs: metrics.webhookTickMs.map(a => a.length) }, null, 2));
        console.log(JSON.stringify(s));
        await sleep(Math.max(0, Math.min(30000, end - Date.now())));
      }
    }
    await Promise.all([loop('worker', 0), loop('worker', 1), loop('outbox', 0), loop('outbox', 1), sample()]);
    metrics.finish = new Date().toISOString();
    const targetRows = await db.select().from(postTargets), postRows = await db.select().from(posts);
    for (const t of targetRows) metrics.statuses[t.status] = (metrics.statuses[t.status] ?? 0) + 1;
    for (const p of postRows) metrics.postStatuses[p.status] = (metrics.postStatuses[p.status] ?? 0) + 1;
    metrics.recovered = (await db.select().from(postEvents).where(eq(postEvents.type, 'recovered'))).length;
    metrics.outbox = await db.execute(sql`select status,count(*)::int as count,min(next_attempt_at) as oldest_next_attempt from webhook_deliveries group by status`);
    assert.equal(metrics.duplicateSuccess, 0); assert.equal(metrics.illegalRepeat, 0); assert.equal(metrics.duplicateDeliveries, 0);
    assert.equal(metrics.errors.length, 0);
    assert(targetRows.every(t => ['published', 'failed', 'skipped', 'needs_review'].includes(t.status) || (t.status === 'queued' && t.nextAttemptAt !== null && t.attempts < 5)), 'No orphan publishing or invalid queued targets');
    for (const p of postRows) {
      const targets = targetRows.filter(t => t.postId === p.id);
      assert(['published', 'partially_failed', 'failed', 'skipped'].includes(p.status) || (p.status === 'scheduled' && targets.some(t => t.status === 'queued' && t.nextAttemptAt)), 'Post has valid terminal/queued aggregate');
    }
    if (seconds >= 660) assert.equal(metrics.recovered, 12);
    metrics.passed = true;
  } finally {
    await deleteFixtureUsers(db).where(eq(users.id, uid));
    const [remaining] = await db.execute(sql`select (select count(*) from users)+(select count(*) from workspaces)+(select count(*) from posts)+(select count(*) from post_targets)+(select count(*) from webhook_endpoints)+(select count(*) from webhook_deliveries) as count`);
    assert.equal(Number(remaining.count), 0, 'Fixture cleanup');
  }
}
main().catch(e => { metrics.errors.push(e instanceof assert.AssertionError ? e.message : `Harness ${e instanceof Error ? e.name : 'error'} (details suppressed)`); process.exitCode = 1; }).finally(async () => {
  if (receiver.listening) await new Promise<void>(resolve => receiver.close(() => resolve()));
  await closeDb?.();
  if (created) { admin(`DROP DATABASE ${quote(dbName)};`); metrics.cleanup = true; }
  writeFileSync(reportDir + '/soak-results.json', JSON.stringify({ ...metrics, histories: Object.fromEntries(histories) }, null, 2));
  console.log(JSON.stringify({ passed: metrics.passed, cleanup: metrics.cleanup, errors: metrics.errors, statuses: metrics.statuses }));
});
