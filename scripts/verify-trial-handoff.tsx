import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const handoff = readFileSync('components/billing/ContinueCheckout.tsx', 'utf8');
const checkout = readFileSync('components/billing/CheckoutButton.tsx', 'utf8');
const billing = readFileSync('app/app/billing/page.tsx', 'utf8');

test('continue checkout is an explicit, honest handoff', () => {
  assert.doesNotMatch(handoff, /useEffect|querySelector\(['"]button['"]\)|\.click\(\)/);
  assert.match(checkout, /onClick=\{checkout\}/);
  assert.match(handoff, /14 days free/);
  assert.match(handoff, /No card is needed/);
  assert.match(handoff, /Amazing AI Apps/);
  assert.match(handoff, /monthlyEuro/);
  assert.match(handoff, /First set up your brand and look around/);
  assert.match(handoff, /href="\/app"/);
  assert.match(handoff, /href="\/app\/billing"/);
  assert.match(billing, /Start 14-day free trial/);
  assert.match(billing, /!subscription|!workspace\.trialUsedAt/);
});

console.log('trial handoff: no automatic checkout, disclosure, plan price, and /app alternative PASS');
