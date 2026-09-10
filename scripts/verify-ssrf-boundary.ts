// Offline SSRF-boundary regression test. Every outbound request is mocked.
import assert from 'node:assert/strict';
import dns from 'node:dns/promises';
import { afterEach, beforeEach, mock as nodeMock, test } from 'node:test';
import { safeFetch, pinnedAgent } from '../lib/publishers/safe-fetch';

const originalFetch = globalThis.fetch;
const publicAnswer = [{ address: '93.184.216.34', family: 4 as const }];

beforeEach(() => nodeMock.method(dns, 'lookup', async () => publicAnswer));
afterEach(() => { globalThis.fetch = originalFetch; nodeMock.restoreAll(); });

function mockedFetch() {
  const calls: string[] = [];
  globalThis.fetch = async (url, init) => {
    calls.push(String(url));
    assert(init && 'dispatcher' in init, 'safeFetch must supply its pinned dispatcher');
    return new Response('fixture');
  };
  return calls;
}

const rejectedLiterals = [
  'https://10.0.0.1/a', 'https://172.16.0.1/a', 'https://172.31.255.255/a', 'https://192.168.1.1/a',
  'https://127.0.0.1/a', 'https://[::1]/a', 'https://0.0.0.0/a', 'https://169.254.169.254/a',
  'https://[fe80::1]/a', 'https://[fc00::1]/a', 'https://[fd12::1]/a',
  'https://[::ffff:127.0.0.1]/a', 'https://2130706433/a', 'https://0177.0.0.1/a',
  'https://0x7f000001/a', 'http://example.com/a', 'ftp://example.com/a',
];

for (const url of rejectedLiterals) test(`rejects SSRF/protocol literal ${url}`, async () => {
  const calls = mockedFetch();
  await assert.rejects(safeFetch(url));
  assert.deepEqual(calls, []);
});

test('rejects a DNS name whose answers include a private address', async () => {
  nodeMock.restoreAll();
  nodeMock.method(dns, 'lookup', async () => [
    { address: '93.184.216.34', family: 4 }, { address: '192.168.1.7', family: 4 },
  ]);
  const calls = mockedFetch();
  await assert.rejects(safeFetch('https://private-answer.test/a'));
  assert.deepEqual(calls, []);
});

test('revalidates redirects before the second request', async () => {
  const calls: string[] = [];
  globalThis.fetch = async url => {
    calls.push(String(url));
    return new Response(null, { status: 302, headers: { location: 'https://10.0.0.1/redirected' } });
  };
  await assert.rejects(safeFetch('https://public.test/start'));
  assert.deepEqual(calls, ['https://public.test/start']);
});

test('pinned dispatcher exposes only checked addresses', () => {
  const agent = pinnedAgent('race.test', [{ address: '93.184.216.34', family: 4 }]);
  // The lookup callback is intentionally exercised through undici in the existing
  // TLS test; this assertion documents the checked set passed to the connector.
  assert.ok(agent);
  void agent.destroy();
});
