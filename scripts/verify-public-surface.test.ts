import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('public login action is guarded before funnel recording', () => {
  const source = readFileSync('app/login/page.tsx', 'utf8');
  assert.match(source, /signInActionLimited\(await headers\(\)\)/);
  assert.match(source, /signInActionLimited\(await headers\(\)\).*redirect\("\/login\/check-email\?limited=1/);
  const confirmation = readFileSync('app/login/check-email/page.tsx', 'utf8');
  assert.match(confirmation, /Please wait a little while before requesting another link/);
});

test('waitlist success responses do not enumerate duplicate emails', () => {
  const source = readFileSync('app/api/waitlist/route.ts', 'utf8');
  assert.match(source, /status: status === 429 \? 429 : 202/);
});
