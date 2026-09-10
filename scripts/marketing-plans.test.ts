import test from 'node:test';
import assert from 'node:assert/strict';
import { marketingPlanLimits, marketingPlanPrice } from '../components/marketing/Plans';
import { plans } from '../lib/plans';

test('pricing plan limits are derived from lib/plans.ts', () => {
  for (const plan of ['starter', 'agency'] as const) {
    assert.equal(marketingPlanPrice(plan), `€${plans[plan].monthlyEuro}`);
    assert.deepEqual(marketingPlanLimits(plan), [
      `${plans[plan].brands} brands`,
      `${plans[plan].seats} ${plans[plan].seats === 1 ? 'user' : 'users'}`,
      `${plans[plan].mediaBytes >= 1024 * 1024 * 1024 ? plans[plan].mediaBytes / (1024 * 1024 * 1024) + ' GiB' : plans[plan].mediaBytes / (1024 * 1024) + ' MiB'} storage`,
    ]);
  }
});
