import assert from 'node:assert/strict';
import test from 'node:test';
import postgres from 'postgres';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../db/schema';
import { visitReport } from '../lib/visit-report';
import { assertVerificationDatabase, createIsolatedDatabase } from './isolated-db.mjs';

const configured = Boolean(process.env.VERIFY_ADMIN_DATABASE_URL);

test('real SQL reads exactly the seeded daily aggregates over a zero-filled UTC window', { skip: !configured && 'VERIFY_ADMIN_DATABASE_URL missing; no database fallback', timeout: 120000 }, async () => {
  let isolated: Awaited<ReturnType<typeof createIsolatedDatabase>> | undefined;
  let client: ReturnType<typeof postgres> | undefined;
  try {
    isolated = await createIsolatedDatabase();
    assertVerificationDatabase(isolated.url);
    client = postgres(isolated.url, { prepare: false, max: 1, connect_timeout: 3 });
    const db = drizzle(client, { schema });
    const now = new Date('2026-09-20T12:00:00.000Z');
    await db.insert(schema.postialVisitDaily).values([
      // Current day: named pages, one sub-threshold page and one sub-threshold referrer.
      { day: '2026-09-20', path: '/', referrerHost: 'google.com', views: 5, visits: 4 },
      { day: '2026-09-20', path: '/pricing', referrerHost: '', views: 2, visits: 2 },
      { day: '2026-09-20', path: '/docs/guide', referrerHost: 'bing.com', views: 1, visits: 1 },
      { day: '2026-09-20', path: '(unknown route)', referrerHost: '', views: 4, visits: 2 },
      // Past day inside the window: threshold and sub-threshold pages and referrers.
      { day: '2026-09-19', path: '/', referrerHost: 'news.ycombinator.com', views: 3, visits: 3 },
      { day: '2026-09-19', path: '/compare', referrerHost: 'reddit.com', views: 2, visits: 1 },
      { day: '2026-09-19', path: '/privacy', referrerHost: 'news.ycombinator.com', views: 1, visits: 0 },
      // Future day and day outside the window: excluded from every aggregate, but the earliest day anchors countingFrom.
      { day: '2026-09-21', path: '/', referrerHost: 'google.com', views: 9, visits: 9 },
      { day: '2026-09-15', path: '/', referrerHost: 'google.com', views: 9, visits: 9 },
    ]);
    await db.execute(sql`set time zone 'Pacific/Honolulu'`);
    const report = await visitReport(3, db, now);
    assert.deepEqual(report.days, [
      { date: '2026-09-18', views: 0, visits: 0, uniques: null },
      { date: '2026-09-19', views: 6, visits: 4, uniques: null },
      { date: '2026-09-20', views: 12, visits: 9, uniques: null },
    ]);
    assert.deepEqual(report.topPages, [
      { page: '/', views: 8 },
      { page: '(unknown route)', views: 4 },
      { page: '(other)', views: 6 },
    ]);
    assert.deepEqual(report.topReferrers, [
      { referrer: '(direct)', views: 6 },
      { referrer: 'google.com', views: 5 },
      { referrer: 'news.ycombinator.com', views: 4 },
      { referrer: '(other)', views: 3 },
    ]);
    assert.equal(report.topPages.reduce((sum, row) => sum + row.views, 0), 18);
    assert.equal(report.topReferrers.reduce((sum, row) => sum + row.views, 0), 18);
    assert.equal(report.coverage.countingFrom, '2026-09-15');
    const serialized = JSON.stringify(report);
    assert.ok(!serialized.includes('2026-09-21'), 'future days are excluded');
    assert.match(serialized, /[Ff]ull HTML document loads reaching the application server/);
    assert.match(serialized, /RSC client navigations and prefetches/);
    assert.match(serialized, /downstream cache/);
    assert.match(serialized, /heuristic/);
    assert.match(serialized, /not people or sessions/);
    assert.match(serialized, /no distinct-person identifier/);
    assert.match(serialized, /consent decision/);
    for (const [input, length] of [[undefined, 30], ['bad', 30], [0, 1], [91, 90], [2.9, 2]] as const) {
      const bounded = await visitReport(input, db, now);
      assert.equal(bounded.days.length, length);
      assert.equal(bounded.days.at(-1)?.date, '2026-09-20');
      assert.ok(bounded.days.every(row => row.uniques === null));
    }
    const midnight = await visitReport(1, db, new Date('2026-09-20T00:00:00.000Z'));
    assert.deepEqual(midnight.days, [{ date: '2026-09-20', views: 12, visits: 9, uniques: null }]);
    const empty = await visitReport(2, db, new Date('2026-10-02T00:00:00.000Z'));
    assert.deepEqual(empty.days, [
      { date: '2026-10-01', views: 0, visits: 0, uniques: null },
      { date: '2026-10-02', views: 0, visits: 0, uniques: null },
    ]);
    assert.deepEqual(empty.topPages, []);
    assert.deepEqual(empty.topReferrers, []);
    assert.equal(empty.coverage.countingFrom, '2026-09-15');
    await db.execute(sql`truncate table ${schema.postialVisitDaily}`);
    const blank = await visitReport(1, db, now);
    assert.deepEqual(blank.days, [{ date: '2026-09-20', views: 0, visits: 0, uniques: null }]);
    assert.deepEqual(blank.topPages, []);
    assert.deepEqual(blank.topReferrers, []);
    assert.equal(blank.coverage.countingFrom, null);
  } finally {
    try { await client?.end({ timeout: 5 }); } finally {
      await isolated?.cleanup();
    }
  }
});
