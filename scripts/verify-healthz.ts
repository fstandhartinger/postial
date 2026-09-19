import assert from 'node:assert/strict';
import { randomBytes, createHmac } from 'node:crypto';
import { assertVerificationDatabase, createIsolatedDatabase, migrateVerificationDatabase } from './isolated-db.mjs';
import { getDb } from '../db';
import { GET } from '../app/healthz/route';
import { workerState } from '../lib/publishing/state';
import journal from '../drizzle/meta/_journal.json';
import { version } from '../package.json';

async function main() {
  const controller = new AbortController();
  const onSignal = () => { process.exitCode = 1; controller.abort(); };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  const originalEnv = Object.fromEntries(['DATABASE_URL', 'AUTH_SECRET', 'WORKER_ENABLED', 'APPROVAL_TRUST_PROXY'].map(key => [key, process.env[key]]));
  const originalWorker = { ...workerState };
  const originalNow = Date.now;
  const originalFetch = globalThis.fetch;
  let isolated: Awaited<ReturnType<typeof createIsolatedDatabase>> | undefined;
  let db: ReturnType<typeof getDb> | undefined;
  type Migration = { id: number; hash: string; created_at: string };
  let saved: Migration[] | undefined;
  let rateKey: string | undefined;
  try {
    if (process.env.VERIFY_ADMIN_DATABASE_URL) {
      const options = { signal: controller.signal, migrate: migrateVerificationDatabase };
      isolated = await createIsolatedDatabase(undefined, options);
      process.env.DATABASE_URL = isolated.url;
    }
    assertVerificationDatabase();
    controller.signal.throwIfAborted();
    process.env.AUTH_SECRET = randomBytes(32).toString('hex');
    process.env.APPROVAL_TRUST_PROXY = 'false';
    process.env.WORKER_ENABLED = 'true';
    rateKey = 'anonymous:healthz:' + createHmac('sha256', process.env.AUTH_SECRET).update('untrusted-peer').digest('hex');
    globalThis.fetch = async () => { throw new Error('External HTTP forbidden in health regression'); };
    db = getDb();
    saved = await db.$client<Migration[]>`select id, hash, created_at from drizzle.__drizzle_migrations order by id`;
    assert(journal.entries.length > 1, 'health fixtures require a nonempty migration journal');
    assert.equal(saved.length, journal.entries.length, 'fixture must start with exactly the installed journal');
    assert.deepEqual(saved.map(row => Number(row.created_at)).sort((a, b) => a - b), journal.entries.map(entry => entry.when).sort((a, b) => a - b));
    const latest = journal.entries[journal.entries.length - 1];
    const frozenNow = originalNow();
    Date.now = () => frozenNow;
    workerState.startedAt = frozenNow;
    const exact = { applied: journal.entries.length, latest: latest.tag as string | null, dbAhead: false };
    async function check(age: number, status: number, migrations = exact, expected = true) {
      controller.signal.throwIfAborted();
      workerState.lastTickAt = new Date(frozenNow - age * 1000).toISOString();
      const response = await GET(new Request('http://localhost/healthz'));
      assert.equal(response.status, status, `worker expected=${expected}, age=${age}s, migrations=${JSON.stringify(migrations)} must return ${status}`);
      assert.equal(response.headers.get('Cache-Control'), 'no-store');
      assert.deepEqual(await response.json(), {
        ok: status === 200, db: true, version,
        migrations,
        worker: { lastTickAt: workerState.lastTickAt, ageSeconds: age, expected },
      });
    }
    await check(300, 200);
    await check(301, 503);
    console.log('PASS: actual GET with real fixture DB, enabled worker at 300s healthy and 301s unhealthy');
    await check(0, 200);
    await db.$client`insert into drizzle.__drizzle_migrations (id, hash, created_at) values (${Math.max(...saved.map(row => row.id)) + 1}, 'synthetic-ahead', ${latest.when + 1})`;
    await check(0, 200, { ...exact, applied: exact.applied + 1, dbAhead: true });
    await db.$client`delete from drizzle.__drizzle_migrations where hash = 'synthetic-ahead'`;
    const missing = saved.find(row => Number(row.created_at) === Math.min(...journal.entries.map(entry => entry.when)))!;
    await db.$client`delete from drizzle.__drizzle_migrations where id = ${missing.id}`;
    await check(0, 503, { ...exact, applied: exact.applied - 1 });
    await db.$client`insert into drizzle.__drizzle_migrations ${db.$client([missing], 'id', 'hash', 'created_at')}`;
    await db.$client`update drizzle.__drizzle_migrations set created_at = ${Math.min(...journal.entries.map(entry => entry.when)) - 1}`;
    await check(0, 503, { ...exact, latest: null });
    await db.$client.begin(async tx => {
      await tx`delete from drizzle.__drizzle_migrations`;
      await tx`insert into drizzle.__drizzle_migrations ${tx(saved!, 'id', 'hash', 'created_at')}`;
    });
    process.env.WORKER_ENABLED = 'false';
    await check(301, 200, exact, false);
    console.log('PASS: fresh/exact, additive-ahead, insufficient-count, no-known-migration, disabled-stale-worker; response fields and no-store');
  } finally {
    Date.now = originalNow;
    Object.assign(workerState, originalWorker);
    globalThis.fetch = originalFetch;
    try {
      if (db && saved) {
        const restore = saved;
        await db.$client.begin(async tx => {
          await tx`delete from drizzle.__drizzle_migrations`;
          if (restore.length) await tx`insert into drizzle.__drizzle_migrations ${tx(restore, 'id', 'hash', 'created_at')}`;
          if (rateKey) await tx`delete from request_rate_limits where key = ${rateKey}`;
        });
      }
    } finally {
      try { await db?.$client.end({ timeout: 5 }); }
      finally {
        try { await isolated?.cleanup(); }
        finally {
          for (const [key, value] of Object.entries(originalEnv)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
          }
          process.removeListener('SIGINT', onSignal);
          process.removeListener('SIGTERM', onSignal);
        }
      }
    }
    console.log('CLEANUP: journal, worker, environment and rate-limit fixture restored; owned connections/database closed');
  }
}
main().catch(error => {
  console.error('FAIL healthz:', error instanceof assert.AssertionError ? error.message : 'setup or database operation failed');
  process.exitCode ||= 1;
});
