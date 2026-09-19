import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { isAdminEmail } from '../lib/funnel';
import { createVisitHandler, normalizeVisitDays } from '../lib/visit-report';

function assertPrivate(response: Response) {
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow');
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  assert.equal(response.headers.get('set-cookie'), null);
}

test('days default, floor and clamp consistently', () => {
  for (const value of [undefined, null, '', ' ', 'invalid', 'NaN', 'Infinity', '1; select 1']) {
    assert.equal(normalizeVisitDays(value), 30);
  }
  for (const [value, expected] of [['0', 1], ['-9', 1], ['1', 1], ['2.9', 2], ['90', 90], ['999', 90]] as const) {
    assert.equal(normalizeVisitDays(value), expected);
  }
});

test('real admin policy denies anonymous, nonadmin and unconfigured access without querying', async () => {
  const previous = process.env.ADMIN_EMAILS;
  let queries = 0;
  try {
    for (const configured of ['', 'operator@example.test']) {
      process.env.ADMIN_EMAILS = configured;
      for (const session of [null, { user: {} }, { user: { email: 'reader@example.test' } }, ...(!configured ? [{ user: { email: 'operator@example.test' } }] : [])]) {
        const handler = createVisitHandler({ auth: async () => session, isAdminEmail, report: async () => { queries++; throw new Error('must not query'); } });
        const response = await handler(new Request('http://localhost/api/operator/visits?days=bad'));
        assert.equal(response.status, 404);
        assert.equal(await response.text(), '');
        assertPrivate(response);
      }
    }
    assert.equal(queries, 0);
  } finally {
    if (previous === undefined) delete process.env.ADMIN_EMAILS; else process.env.ADMIN_EMAILS = previous;
  }
});

test('authorized handler passes only sanitized days, returns aggregates, and hides failures', async () => {
  const previous = process.env.ADMIN_EMAILS;
  process.env.ADMIN_EMAILS = 'operator@example.test';
  try {
    const auth = async () => ({ user: { email: ' OPERATOR@EXAMPLE.TEST ' } });
    const seen: number[] = [];
    const payload = { days: [], topPages: [], topReferrers: [], coverage: {}, definitions: {} };
    const handler = createVisitHandler({ auth, isAdminEmail, report: async days => { seen.push(days); return payload; } });
    for (const suffix of ['', '?days=bad', '?days=0', '?days=999', '?days=2.9']) {
      const response = await handler(new Request(`http://localhost/api/operator/visits${suffix}`));
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), payload);
      assertPrivate(response);
    }
    assert.deepEqual(seen, [30, 30, 1, 90, 2]);
    for (const method of ['HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
      const response = await handler(new Request('http://localhost/api/operator/visits', { method }));
      assert.equal(response.status, 404);
      assertPrivate(response);
    }
    assert.equal(seen.length, 5);
    for (const failure of ['auth', 'report'] as const) {
      const fail = async () => { throw new Error('private-fixture-detail'); };
      const broken = createVisitHandler({ auth: failure === 'auth' ? fail : auth, isAdminEmail, report: fail });
      const response = await broken(new Request('http://localhost/api/operator/visits'));
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { error: 'Service unavailable' });
      assertPrivate(response);
    }
  } finally {
    if (previous === undefined) delete process.env.ADMIN_EMAILS; else process.env.ADMIN_EMAILS = previous;
  }
});

test('route wires existing auth and report through the tested factory with supported exports only', () => {
  const source = readFileSync('app/api/operator/visits/route.ts', 'utf8');
  assert.match(source, /import \{ auth \} from '@\/auth'/);
  assert.match(source, /import \{ isAdminEmail \} from '@\/lib\/funnel'/);
  assert.match(source, /createVisitHandler\(\{ auth, isAdminEmail, report: visitReport \}\)/);
  const exports = [...source.matchAll(/export const (\w+)/g)].map(match => match[1]);
  assert.deepEqual(exports.sort(), ['DELETE', 'GET', 'HEAD', 'OPTIONS', 'PATCH', 'POST', 'PUT', 'runtime'].sort());
});
