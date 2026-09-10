import assert from 'node:assert/strict';
import { portalSessionIdempotencyKey } from '../lib/stripe-idempotency';

const now = Date.UTC(2026, 8, 10, 12, 34, 10);
assert.equal(portalSessionIdempotencyKey('workspace-1', 'cus_1', now), portalSessionIdempotencyKey('workspace-1', 'cus_1', now + 5_000));
assert.notEqual(portalSessionIdempotencyKey('workspace-1', 'cus_1', now), portalSessionIdempotencyKey('workspace-1', 'cus_1', now + 10_000));
assert.notEqual(portalSessionIdempotencyKey('workspace-1', 'cus_1', now), portalSessionIdempotencyKey('workspace-2', 'cus_1', now));
assert.notEqual(portalSessionIdempotencyKey('workspace-1', 'cus_1', now), portalSessionIdempotencyKey('workspace-1', 'cus_2', now));
console.log('PASS double-fire guards: portal idempotency key is stable per workspace/minute');
