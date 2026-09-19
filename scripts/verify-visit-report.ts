import assert from 'node:assert/strict';
import test from 'node:test';
import postgres from 'postgres';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../db/schema';
import { visitReport } from '../lib/visit-report';
import { assertVerificationDatabase, createIsolatedDatabase } from './isolated-db.mjs';

const configured = Boolean(process.env.VERIFY_ADMIN_DATABASE_URL);

test('real SQL limits every aggregate to public browser views and conserves private referrers', { skip: !configured && 'VERIFY_ADMIN_DATABASE_URL missing; no database fallback', timeout: 120000 }, async () => {
  let isolated: Awaited<ReturnType<typeof createIsolatedDatabase>> | undefined;
  let client: ReturnType<typeof postgres> | undefined;
  try {
    isolated = await createIsolatedDatabase();
    assertVerificationDatabase(isolated.url);
    client = postgres(isolated.url, { prepare: false, max: 1, connect_timeout: 3 });
    const db = drizzle(client, { schema });
    const now = new Date('2026-09-17T12:00:00.000Z');
    const fixture = (event: string, day: string, referrerHost: string | null, clientClass = 'browser', occurredAt = new Date(`${day}T00:00:00.000Z`)) => ({
      event, day, referrerHost, clientClass, occurredAt,
      path: '/private-fixture/person@example.test?token=fixture-only',
      props: { email: 'person@example.test', ip: '192.0.2.123', userAgent: 'private-fixture-agent' },
    });
    const rows = [
      fixture('landing_view', '2026-09-16', 'google.com'),
      fixture('pricing_view', '2026-09-16', ' GOOGLE.COM '),
      fixture('docs_view', '2026-09-17', 'google.com'),
      fixture('compare_view', '2026-09-16', 'bing.com'),
      fixture('compare_view', '2026-09-17', 'bing.com'),
      fixture('landing_view', '2026-09-17', null),
      fixture('pricing_view', '2026-09-17', ''),
      fixture('docs_view', '2026-09-17', ' POSTIAL.CO '),
      fixture('landing_view', '2026-09-16', 'customer.private.invalid'),
      fixture('pricing_view', '2026-09-17', 'customer.private.invalid'),
      fixture('compare_view', '2026-09-17', 'https://google.com/private-fixture'),
      fixture('docs_view', '2026-09-17', 'news.ycombinator.com'),
      fixture('docs_view', '2026-09-17', 'google.com.customer.private.invalid'),
      fixture('landing_view', '2026-09-15', 'google.com'),
      fixture('landing_view', '2026-09-18', 'google.com', 'browser', now),
      fixture('landing_view', '2026-09-17', 'google.com', 'browser', new Date('2026-09-17T12:00:00.001Z')),
    ];
    for (const event of ['landing_view', 'pricing_view', 'docs_view', 'compare_view']) {
      for (const clientClass of ['automated', 'internal', 'unknown']) {
        rows.push(fixture(event, '2026-09-17', 'google.com', clientClass));
      }
    }
    for (const event of ['client_ready', 'signup_started', 'signup_completed', 'subscription_active', 'unknown_event']) {
      for (const clientClass of ['browser', 'automated', 'internal', 'unknown']) rows.push(fixture(event, '2026-09-17', 'google.com', clientClass));
    }
    await db.insert(schema.funnelEvents).values(rows);
    await db.execute(sql`set time zone 'Pacific/Honolulu'`);
    const report = await visitReport(2, db, now);
    assert.deepEqual(report.days, [
      { date: '2026-09-16', views: 4, visits: null, uniques: null },
      { date: '2026-09-17', views: 9, visits: null, uniques: null },
    ]);
    assert.deepEqual(Object.fromEntries(report.topPages.map(row => [row.page, row.views])), { '/docs': 4, '/': 3, '/compare': 3, '/pricing': 3 });
    assert.deepEqual(Object.fromEntries(report.topReferrers.map(row => [row.referrer, row.views])), { '(other)': 7, 'google.com': 3, '(direct)': 2, '(own)': 1 });
    assert.equal(report.topPages.reduce((sum, row) => sum + row.views, 0), 13);
    assert.equal(report.topReferrers.reduce((sum, row) => sum + row.views, 0), 13);
    const serialized = JSON.stringify(report);
    for (const forbidden of ['person@example.test', 'private-fixture', 'customer.private.invalid', '192.0.2.123', 'bing.com', 'news.ycombinator.com', 'workspaceId', 'occurredAt', 'props']) assert.ok(!serialized.includes(forbidden));
    assert.match(serialized, /heuristic/);
    assert.match(serialized, /prefetch/);
    assert.match(serialized, /incomplete public route coverage/);
    assert.match(serialized, /not people or sessions/);
    for (const [input, length] of [[undefined, 30], ['bad', 30], [0, 1], [91, 90], [2.9, 2]] as const) {
      const bounded = await visitReport(input, db, now);
      assert.equal(bounded.days.length, length);
      assert.equal(bounded.days.at(-1)?.date, '2026-09-17');
      assert.ok(bounded.days.every(row => row.visits === null && row.uniques === null));
    }
    const empty = await visitReport(2, db, new Date('2026-10-02T00:00:00.000Z'));
    assert.deepEqual(empty.days, [
      { date: '2026-10-01', views: 0, visits: null, uniques: null },
      { date: '2026-10-02', views: 0, visits: null, uniques: null },
    ]);
    assert.ok(empty.topPages.every(row => row.views === 0));
    assert.deepEqual(empty.topReferrers, []);
    const midnight = await visitReport(1, db, new Date('2026-09-17T00:00:00.000Z'));
    assert.deepEqual(midnight.days, [{ date: '2026-09-17', views: 9, visits: null, uniques: null }]);
  } finally {
    try { await client?.end({ timeout: 5 }); } finally {
      await isolated?.cleanup();
    }
  }
});

