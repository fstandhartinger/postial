import test from 'node:test';
import assert from 'node:assert/strict';
import { and, eq } from 'drizzle-orm';
import { getDb } from '../db';
import { funnelEvents } from '../db/schema';
import { recordFunnelEvent, signInFailureDetails, FUNNEL_EVENTS } from '../lib/funnel';

test('sign-in visibility records methods and coarse failure reasons without identity data', async () => {
  assert(FUNNEL_EVENTS.includes('signin_failed'));
  const marker = `signin-visibility-${crypto.randomUUID()}`;
  await recordFunnelEvent('signup_started', { path: marker, props: { method: 'google' } });
  await recordFunnelEvent('signup_started', { path: marker, props: { method: 'email' } });
  await recordFunnelEvent('signup_completed', { path: marker, props: { method: 'google' } });
  await recordFunnelEvent('signup_completed', { path: marker, props: { method: 'email' } });
  await recordFunnelEvent('signin_failed', { path: marker, props: signInFailureDetails('Verification') });
  const rows = await getDb().select().from(funnelEvents).where(eq(funnelEvents.path, marker));
  assert.equal(rows.length, 5);
  assert.deepEqual(rows.map(row => row.props), [
    { method: 'google' }, { method: 'email' }, { method: 'google' }, { method: 'email' },
    { method: 'email', reason: 'verification' },
  ]);
  for (const row of rows) {
    const props = row.props as Record<string, unknown>;
    assert(!Object.keys(props).some(key => /email|user|name|id|identifier/i.test(key)));
    assert(!JSON.stringify(props).includes('@'));
  }
  await getDb().delete(funnelEvents).where(and(eq(funnelEvents.path, marker), eq(funnelEvents.event, 'signup_started')));
  await getDb().delete(funnelEvents).where(and(eq(funnelEvents.path, marker), eq(funnelEvents.event, 'signup_completed')));
  await getDb().delete(funnelEvents).where(and(eq(funnelEvents.path, marker), eq(funnelEvents.event, 'signin_failed')));
  console.log('PASS signin visibility: methods, coarse failure reason, no identity props');
});
