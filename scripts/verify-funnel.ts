import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { conversionRates, FUNNEL_EVENTS, recordFunnelEvent, adminEmails, isAdminEmail, OWN_REFERRER_HOSTS, isOwnReferrer } from '@/lib/funnel';

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
  assert.equal(isOwnReferrer(null), false);
  assert.equal(isOwnReferrer(''), false);
});
