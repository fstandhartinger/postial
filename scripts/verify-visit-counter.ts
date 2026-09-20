import assert from 'node:assert/strict';
import test from 'node:test';
import postgres from 'postgres';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { postialVisitDaily } from '../db/schema';
import { countVisitRequest, flushVisitCounts, readVisitReport } from '../lib/visit-counter';
import { VISIT_STATS_MAX_KEYS } from '../lib/visit-stats';
import { assertVerificationDatabase, createIsolatedDatabase } from './isolated-db.mjs';

const browserUserAgent = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140 Safari/537.36';

/** A counted full-page document load; only the new statistics libs are exercised, nothing else. */
function pageRequest(path: string, referer?: string) {
  const headers = new Headers({ 'sec-fetch-dest': 'document', 'user-agent': browserUserAgent });
  if (referer) headers.set('referer', referer);
  return { method: 'GET', url: `https://postial.co${path}`, headers };
}

const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

test('visit counter accumulates, flushes additively, restores failures and retains 13 months',
  {
    skip: !process.env.DATABASE_URL && !process.env.VERIFY_ADMIN_DATABASE_URL && 'DATABASE_URL/VERIFY_ADMIN_DATABASE_URL missing; no database fallback',
    timeout: 120000,
  },
  async () => {
    let isolated: Awaited<ReturnType<typeof createIsolatedDatabase>> | undefined;
    let client: ReturnType<typeof postgres> | undefined;
    try {
      let url = process.env.DATABASE_URL;
      if (!url) {
        isolated = await createIsolatedDatabase();
        assertVerificationDatabase(isolated.url);
        url = isolated.url;
        process.env.DATABASE_URL = url;
      } else {
        assertVerificationDatabase(url);
      }
      client = postgres(url, { prepare: false, max: 1, connect_timeout: 3 });
      const db = drizzle(client);
      const rows = async () => [...await db.execute<{ day: string; path: string; referrer_host: string; views: number; visits: number }>(
        sql`select ${postialVisitDaily.day}::text as day, ${postialVisitDaily.path} as path, ${postialVisitDaily.referrerHost} as referrer_host,
          ${postialVisitDaily.views} as views, ${postialVisitDaily.visits} as visits from ${postialVisitDaily}
          order by 1, 2, 3`,
      )];
      assert.deepEqual((await rows()).map(row => row.path), [], 'fixture database must start with an empty visit table');
      const columns = await db.execute<{ column_name: string }>(sql`select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'postial_visit_daily' order by column_name`);
      assert.deepEqual(columns.map(row => row.column_name), ['day', 'path', 'referrer_host', 'views', 'visits'], 'the table holds exactly the five aggregate columns');

      const now = Date.now();
      const today = dayOf(now);
      const yesterday = dayOf(now - 86_400_000);
      // Retention first, with no counted traffic at all: an old row is deleted, a 12-month-old row stays.
      const staleDay = dayOf(now - 14 * 31 * 86_400_000);
      const keptDay = dayOf(now - 12 * 31 * 86_400_000);
      const droppedMs = now - 3 * 86_400_000;
      const droppedDay = dayOf(droppedMs);
      await db.insert(postialVisitDaily).values([
        { day: staleDay, path: '/', referrerHost: '', views: 4, visits: 1 },
        { day: keptDay, path: '/pricing', referrerHost: 'google.com', views: 3, visits: 2 },
      ]);
      await flushVisitCounts(now);
      assert.deepEqual(await rows(), [{ day: keptDay, path: '/pricing', referrer_host: 'google.com', views: 3, visits: 2 }]);

      // Mixed hits across two UTC days via the counter's injected-now accumulation path.
      const seed = () => {
        countVisitRequest(pageRequest('/'), now);
        countVisitRequest(pageRequest('/'), now);
        countVisitRequest(pageRequest('/'), now);
        countVisitRequest(pageRequest('/pricing', 'https://www.google.com/search?q=x'), now);
        countVisitRequest(pageRequest('/pricing', 'https://www.postial.co/pricing'), now);
        countVisitRequest({ ...pageRequest('/'), method: 'POST' }, now);
        countVisitRequest({ ...pageRequest('/'), headers: new Headers({ 'sec-fetch-dest': 'empty', 'user-agent': browserUserAgent }) }, now);
        countVisitRequest(pageRequest('/'), now - 86_400_000);
        countVisitRequest(pageRequest('/'), now - 86_400_000);
      };
      seed();
      await flushVisitCounts(now);
      assert.deepEqual(await rows(), [
        { day: keptDay, path: '/pricing', referrer_host: 'google.com', views: 3, visits: 2 },
        { day: yesterday, path: '/', referrer_host: '', views: 2, visits: 2 },
        { day: today, path: '/', referrer_host: '', views: 3, visits: 3 },
        { day: today, path: '/pricing', referrer_host: '', views: 1, visits: 0 },
        { day: today, path: '/pricing', referrer_host: 'google.com', views: 1, visits: 1 },
      ]);

      // The report reads back exactly the flushed aggregate, with uniques null by design.
      const report = await readVisitReport(1);
      assert.deepEqual(report.days, [{ date: today, views: 5, visits: 4, uniques: null }]);

      // Re-counting the same keys flushes as additive increments on the existing rows.
      seed();
      await flushVisitCounts(now);
      assert.deepEqual(await rows(), [
        { day: keptDay, path: '/pricing', referrer_host: 'google.com', views: 3, visits: 2 },
        { day: yesterday, path: '/', referrer_host: '', views: 4, visits: 4 },
        { day: today, path: '/', referrer_host: '', views: 6, visits: 6 },
        { day: today, path: '/pricing', referrer_host: '', views: 2, visits: 0 },
        { day: today, path: '/pricing', referrer_host: 'google.com', views: 2, visits: 2 },
      ]);

      // A failed write restores current/previous-day totals (the droppedDay row is dropped, never written).
      const beforeFailure = await rows();
      countVisitRequest(pageRequest('/docs/restore-a'), now);
      countVisitRequest(pageRequest('/docs/restore-b'), now);
      countVisitRequest(pageRequest('/'), droppedMs);
      const failing = { execute: () => Promise.reject(new Error('fixture connection refused')) };
      await flushVisitCounts(now, failing);
      await flushVisitCounts(now);
      assert.deepEqual(await rows(), [
        ...beforeFailure.slice(0, 3),
        { day: today, path: '/docs/restore-a', referrer_host: '', views: 1, visits: 1 },
        { day: today, path: '/docs/restore-b', referrer_host: '', views: 1, visits: 1 },
        ...beforeFailure.slice(3),
      ]);
      assert.equal((await db.execute<{ count: number }>(sql`select count(*)::int as count from ${postialVisitDaily} where ${postialVisitDaily.day} = ${droppedDay}::date`))[0].count, 0);

      // The key cap holds for new keys; the same guard bounds a restored batch.
      for (let i = 0; i <= VISIT_STATS_MAX_KEYS; i++) countVisitRequest(pageRequest(`/docs/cap-${i}`), now);
      await flushVisitCounts(now);
      const capped = await db.execute<{ count: number }>(sql`select count(*)::int as count from ${postialVisitDaily} where ${postialVisitDaily.path} like '/docs/cap-%'`);
      assert.equal(capped[0].count, VISIT_STATS_MAX_KEYS);
    } finally {
      try { await client?.end({ timeout: 5 }); } finally {
        await isolated?.cleanup();
      }
    }
  });
