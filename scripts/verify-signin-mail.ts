import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Nodemailer from 'next-auth/providers/nodemailer';
import { sendPostialVerificationRequest, SIGN_IN_LINK_MAX_AGE_SECONDS, signInLinkLifetime } from '../lib/auth-email';

test('Postial sign-in mail has matching HTML and text content', async () => {
  let sent: Record<string, unknown> | undefined;
  const provider = Nodemailer({ server: { host: 'unused' }, maxAge: SIGN_IN_LINK_MAX_AGE_SECONDS });
  provider.sendVerificationRequest = sendPostialVerificationRequest;
  provider.server = { name: 'fixture', version: '1', send(mail: { data: Record<string, unknown> }, callback: (error: null, result: unknown) => void) {
    sent = mail.data;
    callback(null, { accepted: ['review@example.invalid'], rejected: [], pending: [] });
  }} as unknown as typeof provider.server;
  const token = 'fixture-token';
  const url = `https://postial.co/api/auth/callback/nodemailer?token=${token}`;
  await provider.sendVerificationRequest({ identifier: 'review@example.invalid', url, provider, theme: {}, token, expires: new Date(Date.now() + SIGN_IN_LINK_MAX_AGE_SECONDS * 1000), request: new Request('https://postial.co/mail') });
  assert(sent);
  const html = String(sent.html);
  const text = String(sent.text);
  assert.match(String(sent.subject), /Postial/);
  assert.equal(text.includes(url), true);
  assert.equal((html.match(new RegExp(token, 'g')) || []).length, 2, 'HTML has button target and visible fallback link');
  assert.equal((text.match(new RegExp(token, 'g')) || []).length, 1);
  assert.match(html, /If you did not request this/);
  assert.match(text, /If you did not request this/);
  assert.match(text, new RegExp(`valid for ${signInLinkLifetime(SIGN_IN_LINK_MAX_AGE_SECONDS)}`));
  assert.notEqual(text.trim(), '');
  assert.equal(html.includes('fixture-token</p>'), false, 'token is not a standalone code');
  assert.match(html, /href="[^"]*token=fixture-token/);
  assert.match(html, /<code>[^<]*token=fixture-token/);
  const previewDir = resolve(process.cwd(), '../work/mail-preview');
  mkdirSync(previewDir, { recursive: true });
  writeFileSync(resolve(previewDir, 'signin.html'), html.replaceAll(token, 'PLACEHOLDER_TOKEN'));
  writeFileSync(resolve(previewDir, 'signin.txt'), text.replaceAll(token, 'PLACEHOLDER_TOKEN'));
});
