import assert from 'node:assert/strict';
import { test } from 'node:test';
import Nodemailer from 'next-auth/providers/nodemailer';
import { sql } from 'drizzle-orm';
import { getDb } from '../db';
import {
  sendPostialVerificationRequest,
  SIGN_IN_EMAIL_RATE_LIMIT,
  SIGN_IN_EMAIL_RATE_WINDOW_SECONDS,
  SIGN_IN_IP_RATE_LIMIT,
  SIGN_IN_IP_RATE_WINDOW_SECONDS,
  SIGN_IN_ACTION_RATE_LIMIT,
  SIGN_IN_ACTION_RATE_WINDOW_SECONDS,
  SIGN_IN_LINK_MAX_AGE_SECONDS,
  signInActionLimited,
} from '../lib/auth-email';

process.env.APPROVAL_TRUST_PROXY = 'true';
const db = getDb();
const url = 'https://postial.co/api/auth/callback/nodemailer?token=fixture-token';

function providerFor(counter: { sent: number }) {
  const provider = Nodemailer({ server: { host: 'unused' }, maxAge: SIGN_IN_LINK_MAX_AGE_SECONDS });
  provider.sendVerificationRequest = sendPostialVerificationRequest;
  provider.server = {
    name: 'fixture', version: '1',
    send(_mail: { data: Record<string, unknown> }, callback: (error: null, result: unknown) => void) {
      counter.sent += 1;
      callback(null, { accepted: ['review@example.invalid'], rejected: [], pending: [] });
    },
  } as unknown as typeof provider.server;
  return provider;
}

async function clearFixtures() {
  await db.execute(sql`delete from request_rate_limits where key like 'signin:%'`);
}

test('login Server Action has a separate per-IP budget before funnel writes', async () => {
  await clearFixtures();
  const headers = new Headers({ 'x-real-ip': '198.51.100.20' });
  for (let i = 0; i < SIGN_IN_ACTION_RATE_LIMIT; i += 1) assert.equal(await signInActionLimited(headers), false);
  assert.equal(await signInActionLimited(headers), true);
  assert.equal(SIGN_IN_ACTION_RATE_WINDOW_SECONDS, 60);
});

async function send(provider: ReturnType<typeof providerFor>, email: string, ip: string) {
  return provider.sendVerificationRequest({
    identifier: email, url, provider, theme: {}, token: 'fixture-token',
    expires: new Date(Date.now() + SIGN_IN_LINK_MAX_AGE_SECONDS * 1000),
    request: new Request('https://postial.co/api/auth/signin/nodemailer', { headers: { 'x-real-ip': ip } }),
  });
}

test('sign-in mail has recipient and IP limits without changing the caller response', async () => {
  await clearFixtures();
  const counter = { sent: 0 };
  const provider = providerFor(counter);
  const responses: Response[] = [];
  for (let i = 0; i < 4; i += 1) {
    await send(provider, 'review@example.invalid', '198.51.100.10');
    responses.push(new Response(null, { status: 302, headers: { location: '/login/check-email' } }));
  }
  assert.equal(counter.sent, SIGN_IN_EMAIL_RATE_LIMIT);
  assert.deepEqual(responses.map(response => [response.status, response.headers.get('location')]), [[302, '/login/check-email'], [302, '/login/check-email'], [302, '/login/check-email'], [302, '/login/check-email']]);

  await clearFixtures();
  counter.sent = 0;
  for (let i = 0; i < SIGN_IN_IP_RATE_LIMIT + 1; i += 1) {
    await send(provider, `review-${i}@example.invalid`, '198.51.100.11');
  }
  assert.equal(counter.sent, SIGN_IN_IP_RATE_LIMIT);
});

test('sign-in mail sends again after both fixed windows expire', async () => {
  await clearFixtures();
  const counter = { sent: 0 };
  const provider = providerFor(counter);
  await send(provider, 'again@example.invalid', '198.51.100.12');
  await db.execute(sql`update request_rate_limits set expires_at = now() - interval '1 second' where key like 'signin:%'`);
  await send(provider, 'again@example.invalid', '198.51.100.12');
  assert.equal(counter.sent, 2);
  assert.equal(SIGN_IN_EMAIL_RATE_WINDOW_SECONDS, 900);
  assert.equal(SIGN_IN_IP_RATE_WINDOW_SECONDS, 3600);
});
