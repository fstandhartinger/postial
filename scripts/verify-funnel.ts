import test from 'node:test';
import assert from 'node:assert/strict';
import { conversionRates, FUNNEL_EVENTS, recordFunnelEvent, adminEmails, isAdminEmail } from '@/lib/funnel';

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
