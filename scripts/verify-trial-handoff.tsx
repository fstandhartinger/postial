import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const handoff = readFileSync('components/billing/ContinueCheckout.tsx', 'utf8');
const checkout = readFileSync('components/billing/CheckoutButton.tsx', 'utf8');
const billing = readFileSync('app/app/billing/page.tsx', 'utf8');
const page = readFileSync('app/app/continue/page.tsx', 'utf8');
const eligibility = readFileSync('lib/trial-eligibility.ts', 'utf8');

test('continue checkout is an explicit, honest handoff', () => {
  assert.doesNotMatch(handoff, /useEffect|querySelector\(['"]button['"]\)|\.click\(\)/);
  assert.match(checkout, /onClick=\{checkout\}/);
  assert.match(handoff, /14 days free/);
  assert.match(handoff, /No card is needed/);
  assert.match(handoff, /Amazing AI Apps/);
  assert.match(handoff, /monthlyEuro/);
  assert.match(handoff, /trialStatus/);
  assert.match(handoff, /already used its trial period/);
  assert.match(handoff, /could not confirm a free trial/);
  assert.match(handoff, /trialAvailable &&/);
  assert.match(handoff, /payment method is required/);
  assert.match(handoff, /First set up your brand and look around/);
  assert.match(handoff, /href="\/app"/);
  assert.match(handoff, /href="\/app\/billing"/);
  assert.match(billing, /Start 14-day free trial/);
  assert.match(billing, /!subscription|!workspace\.trialUsedAt/);
  assert.match(page, /trialEligibility/);
  assert.match(page, /trialStatus/);
  assert.match(eligibility, /!input\.trialUsedAt && !existing\.data\.length && !input\.localStripeSubscriptionId/);
  assert.doesNotMatch(eligibility, /update\(|insert\(|delete\(/);
  const spentVariant = handoff.match(/This workspace has already used its trial period[^']+/)?.[0] ?? '';
  assert.equal(spentVariant, 'This workspace has already used its trial period. The monthly price applies now and a payment method is required.');
  assert.doesNotMatch(spentVariant, /14 days free|No card|start the 14-day trial later/);
});

console.log('trial handoff: eligible and spent-trial variants, safe Stripe fallback PASS');
