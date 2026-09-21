import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { conversionRates, FUNNEL_EVENTS, recordFunnelEvent, adminEmails, isAdminEmail, OWN_REFERRER_HOSTS, isOwnReferrer, funnelReport } from '@/lib/funnel';
import { getDb } from '../db';
import { funnelEvents, users, workspaces } from '../db/schema';
import { deleteFixtureUsers } from './fixture-cleanup';

// Tests above may blank DATABASE_URL on purpose (best-effort writes); the report and
// migration checks below need the suite's isolated database, so the original URL is
// captured before any test runs and restored when the database is first used.
const suiteDatabaseUrl = process.env.DATABASE_URL;
let db: ReturnType<typeof getDb> | undefined;
function verifyDb() {
  process.env.DATABASE_URL = suiteDatabaseUrl;
  return db ??= getDb();
}

test('allowlist rejects unknown events and write failures are best effort', async () => {
  assert.equal(FUNNEL_EVENTS.includes('not_a_funnel_event' as never), false);
  process.env.DATABASE_URL = '';
  await assert.doesNotReject(() => recordFunnelEvent('landing_view'));
  await assert.doesNotReject(() => recordFunnelEvent('not_a_funnel_event'));
});

test('conversion rates use each preceding stage', () => {
  assert.deepEqual(conversionRates({ landing_view: 100, signup_started: 20, signup_completed: 10, workspace_created: 5, channel_connected: 2, subscription_active: 1 }), {
    signup_started: 0.2, signup_completed: 0.5, workspace_created: 0.5, channel_connected: 0.4, subscription_active: 0.5,
  });
});

test('admin configuration fails closed', () => {
  delete process.env.ADMIN_EMAILS;
  assert.deepEqual(adminEmails(), []);
  process.env.ADMIN_EMAILS = 'Admin@postial.co, other@example.test';
  assert.deepEqual(adminEmails(), ['admin@postial.co', 'other@example.test']);
  assert.equal(isAdminEmail(null), false);
  assert.equal(isAdminEmail('wrong@example.test'), false);
  assert.equal(isAdminEmail('ADMIN@POSTIAL.CO'), true);
});

test('product paths keep funnel measurement outside critical transactions', async () => {
  process.env.DATABASE_URL = '';
  await assert.doesNotReject(() => recordFunnelEvent('workspace_created'));
  const oauth = readFileSync('lib/publishers/oauth.ts', 'utf8');
  const publishing = readFileSync('lib/publishing/index.ts', 'utf8');
  const postService = readFileSync('lib/api/post-service.ts', 'utf8');
  assert.doesNotMatch(oauth, /select\(\{ workspaceId: brands\.workspaceId \}/);
  assert.doesNotMatch(publishing, /tx\.select\(\{ workspaceId: brands\.workspaceId \}/);
  assert.doesNotMatch(postService, /recordFunnelEvent/);
});

test('funnel fix regression guards cover all six findings', () => {
  const funnel = readFileSync('lib/funnel.ts', 'utf8');
  const retention = readFileSync('lib/media/retention.ts', 'utf8');
  const posts = readFileSync('lib/api/posts.ts', 'utf8');
  const bulk = readFileSync('lib/api/bulk.ts', 'utf8');
  const webhook = readFileSync('app/api/stripe/webhook/route.ts', 'utf8');
  const layout = readFileSync('app/app/layout.tsx', 'utf8');
  const admin = readFileSync('app/app/admin/funnel/page.tsx', 'utf8');
  assert.match(retention, /funnel_events[\s\S]*limit 1000/);
  assert.match(funnel, /FUNNEL_VIEW_DAILY_CAP|publicViewCounts/);
  assert.match(funnel, /try \{[\s\S]*await headers\(\)/);
  assert.match(posts, /created && data\.scheduled_at/);
  assert.match(bulk, /!replay[\s\S]*row\.status === 201/);
  assert.match(webhook, /becameActive/);
  assert.match(layout, /split\('\?', 1\)/);
  assert.match(layout, /isAdminEmail\(session\?\.user\?\.email\)/);
  assert.match(admin, /Event conversion rates \(raw event counts\)/);
  assert.match(funnel, /workspaceConversions/);
});

test('own redirect hops are not counted as arrivals', () => {
  // Every referrer host the funnel has ever recorded is ours except one. Reading the page-view
  // total as a visitor count therefore overstates reach by whatever the redirects contribute:
  // 40 of 84 browser-shaped landing views in the twelve hours to 2026-09-12 10:00.
  for (const host of OWN_REFERRER_HOSTS) assert.equal(isOwnReferrer(host), true, host);
  assert.equal(isOwnReferrer('POSTIAL.NET'), true, 'host comparison is case-insensitive');
  assert.equal(isOwnReferrer(' postial.co '), true, 'a padded host is still ours');
  assert.equal(isOwnReferrer('news.ycombinator.com'), false, 'the one external referrer stays external');
  assert.equal(isOwnReferrer('notpostial.co'), false, 'a lookalike host is not ours');
  const previousAppUrl = process.env.APP_URL;
  process.env.APP_URL = 'https://staging.example.test:8443';
  assert.equal(isOwnReferrer('staging.example.test'), true, 'the host we are served from counts as ours');
  assert.equal(isOwnReferrer('example.test'), false, 'a parent domain of our host is not ours');
  process.env.APP_URL = 'not a url';
  assert.equal(isOwnReferrer('staging.example.test'), false, 'an unparseable app url admits nobody');
  if (previousAppUrl === undefined) delete process.env.APP_URL; else process.env.APP_URL = previousAppUrl;
  assert.equal(isOwnReferrer(null), false);
  assert.equal(isOwnReferrer(''), false);
});

test('report separates people, billing and distinct workspaces across client classes', async () => {
  const db = verifyDb();
  const today = new Date().toISOString().slice(0, 10);
  const userId = crypto.randomUUID(), marker = `/verify-funnel-report-${userId}`;
  let firstWorkspaceId = '', secondWorkspaceId = '';
  try {
    // Fresh suite database: before anything is seeded, both denominators are zero and the
    // rates must be null — never 0 and never NaN.
    const empty = await funnelReport(30);
    if (empty.workspaceTotals.workspace_created === 0) assert.equal(empty.billingConversions.trial_started, null, 'a zero denominator must read null, not 0');
    if (empty.workspaceTotals.trial_started === 0) assert.equal(empty.billingConversions.subscription_paid, null, 'a zero denominator must read null, not 0');
    for (const rate of Object.values(empty.billingConversions)) assert.ok(rate === null || (Number.isFinite(rate) && rate >= 0 && rate <= 1), 'no rate may be NaN');

    await db.insert(users).values({ id: userId, name: 'Funnel report fixture' });
    const [first] = await db.insert(workspaces).values({ name: 'Funnel report fixture', slug: `fixture-${userId}`, ownerUserId: userId }).returning();
    firstWorkspaceId = first.id;
    const [second] = await db.insert(workspaces).values({ name: 'Funnel report fixture 2', slug: `fixture-2-${userId}`, ownerUserId: userId }).returning();
    secondWorkspaceId = second.id;
    const [third] = await db.insert(workspaces).values({ name: 'Funnel report fixture 3', slug: `fixture-3-${userId}`, ownerUserId: userId }).returning();
    await db.insert(funnelEvents).values([
      // Registrations: only the browser row counts as a person.
      { event: 'signup_started', day: today, path: marker, clientClass: 'browser' },
      { event: 'signup_started', day: today, path: marker, clientClass: 'internal' },
      { event: 'signup_started', day: today, path: marker, clientClass: 'unknown' },
      // Two of three workspaces were created by real browsers before the third appears.
      { event: 'workspace_created', day: today, path: marker, workspaceId: firstWorkspaceId, clientClass: 'browser' },
      { event: 'workspace_created', day: today, path: marker, workspaceId: secondWorkspaceId, clientClass: 'browser' },
      // Billing: browser and system count, internal and automated are excluded.
      { event: 'checkout_started', day: today, path: marker, workspaceId: firstWorkspaceId, clientClass: 'system' },
      { event: 'trial_started', day: today, path: marker, workspaceId: firstWorkspaceId, clientClass: 'system' },
      { event: 'trial_started', day: today, path: marker, workspaceId: firstWorkspaceId, clientClass: 'system' },
      { event: 'trial_started', day: today, path: marker, clientClass: 'internal' },
      { event: 'subscription_paid', day: today, path: marker, workspaceId: firstWorkspaceId, clientClass: 'system' },
      { event: 'subscription_paid', day: today, path: marker, clientClass: 'system' },
      { event: 'subscription_paid', day: today, path: marker, clientClass: 'internal' },
      { event: 'subscription_paid', day: today, path: marker, clientClass: 'automated' },
    ]);
    const before = await funnelReport(30);
    assert.equal(before.accountTotals.signup_started, before.totals.signup_started, 'account stages read the browser class only');
    assert.equal(before.accountTotals.signup_started, 1);
    assert.equal(before.billingTotals.checkout_started, 1);
    assert.equal(before.billingTotals.trial_started, 2, 'browser + system; internal is excluded');
    assert.equal(before.billingTotals.subscription_paid, 2, 'browser + system; internal and automated are excluded');
    assert.equal(before.billingConversions.trial_started, 0.5, 'two workspaces created, one trialed');
    assert.equal(before.billingConversions.subscription_paid, 1, 'one trialed workspace paid');
    // Two rows for the same workspace count once over distinct workspaces, and the row
    // without a workspace is billed but is not a workspace step.
    assert.equal(before.workspaceTotals.workspace_created, 2);
    assert.equal(before.workspaceTotals.trial_started, 1);
    assert.equal(before.workspaceTotals.subscription_paid, 1);
    // Every stored class stays in its own bucket.
    assert.ok(before.clientClassTotals.internal.signup_started >= 1);
    assert.ok(before.clientClassTotals.unknown.signup_started >= 1);
    assert.ok(before.clientClassTotals.system.trial_started >= 2);
    // Billing rows recorded here carry a real class from today on.
    assert.equal(before.classAttributionFrom, today);

    await db.insert(funnelEvents).values([
      { event: 'workspace_created', day: today, path: marker, workspaceId: third.id, clientClass: 'browser' },
    ]);
    const after = await funnelReport(30);
    assert.equal(after.accountTotals.workspace_created, 3, 'all three browser-created workspaces are people');
    assert.equal(after.billingConversions.trial_started, 1 / 3, 'still one trialed workspace out of three created');
    assert.equal(after.billingConversions.subscription_paid, 1);

    // The plain-English definitions must carry the legacy marker, the past_due exclusion
    // and the attribution break.
    assert.match(after.definitions.subscription_active, /not a paid conversion/);
    assert.match(after.definitions.pastDueRecovery, /past_due/);
    assert.match(after.definitions.pastDueRecovery, /recovered payment/);
    assert.match(after.definitions.classAttributionFrom, /unknown/);
    assert.match(after.definitions.billingTotals, /browser \+ system/);
    assert.match(after.definitions.accountTotals, /browser/);
    assert.match(after.definitions.billingConversions, /null/);
  } finally {
    await db.delete(funnelEvents).where(eq(funnelEvents.path, marker));
    await deleteFixtureUsers(db).where(eq(users.id, userId));
  }
});

test('migration 0029 accepts the system class and still rejects others', async () => {
  const db = verifyDb();
  const today = new Date().toISOString().slice(0, 10);
  const marker = `/verify-funnel-0029-${crypto.randomUUID()}`;
  try {
    await db.insert(funnelEvents).values({ event: 'landing_view', day: today, path: marker, clientClass: 'system' });
    await assert.rejects(
      () => db.insert(funnelEvents).values({ event: 'landing_view', day: today, path: marker, clientClass: 'not-a-class' }),
      (error: unknown) => String((error as { cause?: { message?: string } }).cause?.message ?? error).includes('funnel_events_client_class_check'),
      'the 0029 check constraint must still reject unknown classes',
    );
  } finally {
    await db.delete(funnelEvents).where(eq(funnelEvents.path, marker));
  }
});

test.after(async () => { if (db) await db.$client.end(); });
