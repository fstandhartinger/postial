// Run: npx tsx --test scripts/verify-publishers.ts (all HTTP is mocked).
import assert from 'node:assert/strict';
import dns from 'node:dns/promises';
import { beforeEach, mock as nodeMock } from 'node:test';
import { safeFetch, publicAddress } from '../lib/publishers/safe-fetch';
import { afterEach, test } from 'node:test';
import { availableProviders, getPublisher, PublishError, type Credentials } from '../lib/publishers';
import { validateConnection } from '../lib/publishers/connection';
import { json } from '../lib/publishers/http';
import { FACEBOOK_TEXT_LIMIT } from '../lib/publishers/facebook';

beforeEach(() => { nodeMock.method(dns, 'lookup', async () => [{ address: '93.184.216.34', family: 4 }]); });
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; nodeMock.restoreAll(); });
const credentials: Record<string, Credentials> = {
  bluesky: { identifier: 'alice.test', appPassword: 'test-secret' },
  mastodon: { instanceUrl: 'https://mastodon.test', accessToken: 'test-secret' },
  telegram: { botToken: 'test-secret', chatId: '@channel' },
  linkedin: { accessToken: 'test-secret', externalId: 'person-1' },
};
process.env.LINKEDIN_CLIENT_ID = 'local-linkedin';
process.env.LINKEDIN_CLIENT_SECRET = 'local-linkedin-secret';
const session = { did: 'did:plc:alice', handle: 'alice.test', accessJwt: 'temporary-secret', didDoc: { service: [{ id: '#atproto_pds', serviceEndpoint: 'https://bsky.social' }] } };
const message = { message_id: 42, chat: { id: -123, username: 'channel' } };
function response(body: unknown, status = 200, headers: HeadersInit = {}) { return new Response(JSON.stringify(body), { status, headers }); }
function ok(url: string): Response {
  if (url.includes('image.test')) return new Response('image', {headers:{'content-type':'image/png'}});
  if (url.endsWith('createSession')) return response(session);
  if (url.includes('getRecord?')) return response({ error: 'RecordNotFound' }, 400);
  if (url.endsWith('createRecord')) return response({ uri: 'at://did:plc:alice/app.bsky.feed.post/key' });
  if (url.endsWith('verify_credentials')) return response({ id: '7', acct: 'alice', url: 'https://mastodon.test/@alice' });
  if (url.endsWith('/instance')) return response({ configuration: { statuses: { max_characters: 500 } } });
  if (url.endsWith('/statuses')) return response({ id: '8', url: 'https://mastodon.test/@alice/8' });
  if (url.endsWith('getMe')) return response({ ok: true, result: { id: 1, username: 'bot' } });
  if (url.endsWith('getChat')) return response({ ok: true, result: { id: -123, title: 'Channel', username: 'channel' } });
  if (url.endsWith('sendMediaGroup')) return response({ ok: true, result: [message, message] });
  if (/sendMessage|sendPhoto/.test(url)) return response({ ok: true, result: message });
  throw new Error(`Unexpected mock route: ${url}`);
}
function mock(handler = (url: string, _init?: RequestInit): Response => { void _init; return ok(url); }) {
  const calls: { url: string; init: RequestInit }[] = [];
  globalThis.fetch = async (url, init) => { calls.push({ url: String(url), init: init ?? {} }); return handler(String(url), init); };
  return calls;
}
function errorCode(code: string, retryable?: boolean, retryAfterSeconds?: number) {
  return (error: unknown) => {
    assert.ok(error instanceof PublishError);
    assert.equal(error.code, code);
    if (retryable !== undefined) assert.equal(error.retryable, retryable);
    if (retryAfterSeconds !== undefined) assert.equal(error.retryAfterSeconds, retryAfterSeconds);
    assert.ok(!JSON.stringify(error).includes('test-secret'));
    assert.ok(!error.message.includes('temporary-secret'));
    return true;
  };
}

test('registry loads configured providers', () => assert.deepEqual(availableProviders().sort(), ['bluesky', 'linkedin', 'mastodon', 'telegram']));
for (const provider of ['bluesky', 'mastodon', 'telegram'] as const) {
  const adapter = getPublisher(provider);
  const creds = credentials[provider];
  test(`${provider}: validate account`, async () => {
    mock(); const account = await adapter.validate(creds);
    assert.equal(account.externalId, { bluesky: 'did:plc:alice', mastodon: '7', telegram: '-123' }[provider]);
    assert.equal(account.displayName, { bluesky: '@alice.test', mastodon: '@alice@mastodon.test', telegram: 'Channel' }[provider]);
  });
  test(`${provider}: validate 401`, async () => {
    mock(() => response({ error: 'test-secret' }, 401));
    await assert.rejects(adapter.validate(creds), errorCode('AUTH_EXPIRED', false));
  });
  test(`${provider}: first connection authentication guidance`, async () => {
    mock(() => response({error: 'test-secret'}, 401));
    await assert.rejects(validateConnection(adapter, creds), error => {
      assert(error instanceof PublishError); assert.equal(error.humanMessage, 'Check the token/app password and scopes, then connect again.'); return true;
    });
    await assert.rejects(adapter.publish(creds, {text: 'fixture', idempotencyKey: 'fixture'}), error => {
      assert(error instanceof PublishError); assert.match(error.humanMessage, /Reconnect/); return true;
    });
  });
  test(`${provider}: publish request`, async () => {
    const calls = mock();
    const result = await adapter.publish(creds, { text: '😀 café https://example.com', idempotencyKey: 'stable-key' });
    assert.ok(result.remoteId); assert.ok(result.url);
    const sent = calls.at(-1)!; const body = JSON.parse(String(sent.init.body));
    if (provider === 'bluesky') {
      assert.equal(body.record.text, '😀 café https://example.com');
      assert.deepEqual(body.record.facets[0].index, { byteStart: 11, byteEnd: 30 });
      assert.equal(body.record.facets[0].features[0].uri, 'https://example.com');
    } else if (provider === 'mastodon') {
      assert.equal(new Headers(sent.init.headers).get('Idempotency-Key'), 'stable-key');
      assert.equal(body.status, '😀 café https://example.com');
    } else { assert.equal(body.disable_web_page_preview, false); assert.equal(body.chat_id, '@channel'); }
  });
  for (const status of [429, 500]) test(`${provider}: publish ${status}`, async () => {
    mock(url => /createRecord|statuses$|sendMessage/.test(url) ? response({ description: 'test-secret', parameters: { retry_after: 17 } }, status, { 'Retry-After': '17' }) : ok(url));
    await assert.rejects(adapter.publish(creds, { text: 'hello', idempotencyKey: 'k' }), errorCode(status === 429 ? 'RATE_LIMITED' : 'PROVIDER_DOWN', true, status === 429 ? 17 : undefined));
  });
  test(`${provider}: long text rejected without HTTP`, async () => {
    const calls = mock();
    await assert.rejects(adapter.publish(creds, { text: 'x'.repeat(adapter.maxTextLength + 1), idempotencyKey: 'k' }), errorCode('CONTENT_REJECTED', false));
    assert.equal(calls.length, provider === 'mastodon' ? 1 : 0);
  });
  test(`${provider}: timeout becomes NETWORK`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    globalThis.fetch = (_url, init) => new Promise((_resolve, reject) => { init?.signal?.addEventListener('abort', () => reject(new Error('test-secret'))); });
    const pending = adapter.publish(creds, { text: 'hello', idempotencyKey: 'k' });
    const checked = assert.rejects(pending, errorCode('NETWORK', true));
    t.mock.timers.tick(20_000); await checked;
    t.mock.timers.reset();
  });
}

test('Bluesky counts graphemes and resolves custom PDS without persisting sessions', async () => {
  const calls = mock(url => url.endsWith('createSession') ? response({ ...session, didDoc: { service: [{ id: '#atproto_pds', serviceEndpoint: 'https://custom.test' }] } }) : ok(url));
  await getPublisher('bluesky').publish(credentials.bluesky, { text: '👩‍💻'.repeat(300), idempotencyKey: 'k' });
  assert.equal(calls[1].url, 'https://custom.test/xrpc/com.atproto.server.createSession');
  assert(calls[2].url.includes('/com.atproto.repo.getRecord?'));
  assert.equal(calls[3].url, 'https://custom.test/xrpc/com.atproto.repo.createRecord');
  await getPublisher('bluesky').validate(credentials.bluesky);
  assert.equal(calls.filter(c => c.url.endsWith('createSession')).length, 4);
});
test('Bluesky uploads images and warns for streamed oversize', async () => {
  const calls = mock(url => {
    if (url === 'https://image.test/large') return new Response(new Uint8Array(1_000_001), { headers: { 'Content-Type': 'image/png' } });
    if (url === 'https://image.test/small') return new Response(new Uint8Array(10), { headers: { 'Content-Type': 'image/png' } });
    if (url.endsWith('uploadBlob')) return response({ blob: { ref: 'blob-ref' } });
    return ok(url);
  });
  const result = await getPublisher('bluesky').publish(credentials.bluesky, { text: 'hello', mediaUrls: ['https://image.test/large', 'https://image.test/small'], mediaAlt: {'https://image.test/small':'Accessible small image'}, idempotencyKey: 'k' });
  assert.equal(result.warnings?.length, 1);
  assert.equal(JSON.parse(String(calls.at(-1)!.init.body)).record.embed.images.length, 1);
  assert.equal(JSON.parse(String(calls.at(-1)!.init.body)).record.embed.images[0].alt, 'Accessible small image');
});
test('Mastodon polls async media and attaches IDs', async () => {
  let polls = 0;
  const calls = mock(url => {
    if (url === 'https://image.test/small') return new Response('image', { headers: { 'Content-Type': 'image/png' } });
    if (url.endsWith('/api/v2/media')) return response({ id: 'media1', url: null }, 202);
    if (url.endsWith('/api/v1/media/media1')) { polls++; return polls === 1 ? new Response(null, { status: 206 }) : response({ id: 'media1', url: 'https://image.test/ready' }); }
    return ok(url);
  });
  await getPublisher('mastodon').publish(credentials.mastodon, { text: 'hi', mediaUrls: ['https://image.test/small'], mediaAlt: {'https://image.test/small':'Accessible small image'}, idempotencyKey: 'k' });
  assert.equal(polls, 2);
  assert.ok(calls.find(c => c.url.endsWith('/api/v2/media'))!.init.body instanceof FormData);
  assert.equal((calls.find(c => c.url.endsWith('/api/v2/media'))!.init.body as FormData).get('description'), 'Accessible small image');
  assert.deepEqual(JSON.parse(String(calls.at(-1)!.init.body)).media_ids, ['media1']);
});
test('Mastodon caches discovered limit for preflight', async () => {
  const creds = { ...credentials.mastodon, instanceUrl: 'https://large.test' };
  mock(url => url.endsWith('/instance') ? response({ configuration: { statuses: { max_characters: 1000 } } }) : ok(url));
  await getPublisher('mastodon').validate(creds);
  await getPublisher('mastodon').publish(creds, { text: 'x'.repeat(800), idempotencyKey: 'k' });
  const calls = mock();
  await assert.rejects(getPublisher('mastodon').publish(creds, { text: 'x'.repeat(1001), idempotencyKey: 'k' }), errorCode('CONTENT_REJECTED'));
  assert.equal(calls.length, 1);
});

test('LinkedIn: validate, text-only publish headers/body and warnings', async () => {
  const calls = mock((url, init) => {
    if (url.endsWith('/v2/userinfo')) return response({ sub: 'person-1', name: 'Test Person', vanityName: 'test-person' });
    assert.equal(url, 'https://api.linkedin.com/rest/posts');
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('LinkedIn-Version'), '202508');
    assert.equal(headers.get('X-Restli-Protocol-Version'), '2.0.0');
    assert.equal(headers.get('Authorization'), 'Bearer test-secret');
    const body = JSON.parse(String(init?.body));
    assert.deepEqual(body, { author: 'urn:li:person:person-1', commentary: 'hello', visibility: 'PUBLIC', distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] }, lifecycleState: 'PUBLISHED', isReshareDisabledByAuthor: false });
    return response({ id: 'urn:li:share:1' });
  });
  const adapter = getPublisher('linkedin');
  const account = await adapter.validate(credentials.linkedin); assert.equal(account.externalId, 'person-1'); assert.equal(account.url, 'https://www.linkedin.com/in/test-person');
  const result = await adapter.publish(credentials.linkedin, { text: 'hello', mediaUrls: ['https://image.test/x'], idempotencyKey: 'k' });
  assert.equal(result.remoteId, 'urn:li:share:1'); assert.equal(result.warnings?.length, 1); assert.equal(calls.length, 2);
});
test('LinkedIn: uses x-restli-id from an empty 201 response and builds permalink', async () => {
  mock(url => url.endsWith('/v2/userinfo') ? response({ sub: 'person-1' }) : new Response(null, { status: 201, headers: { 'x-restli-id': 'urn:li:ugcPost:123/unsafe' } }));
  const result = await getPublisher('linkedin').publish(credentials.linkedin, { text: 'hello', idempotencyKey: 'k' });
  assert.equal(result.remoteId, 'urn:li:ugcPost:123/unsafe');
  assert.equal(result.url, undefined);
  mock(() => new Response(null, { status: 201, headers: { 'x-restli-id': 'urn:li:share:123' } }));
  const safe = await getPublisher('linkedin').publish(credentials.linkedin, { text: 'hello', idempotencyKey: 'k' });
  assert.equal(safe.url, 'https://www.linkedin.com/feed/update/urn%3Ali%3Ashare%3A123');
});
test('LinkedIn: common mock error mapping covers forbidden, duplicate and rejected content', async () => {
  mock(() => response({ error: 'forbidden' }, 403));
  await assert.rejects(getPublisher('linkedin').publish(credentials.linkedin, { text: 'hello', idempotencyKey: 'k' }), errorCode('AUTH_EXPIRED', false));
  mock(() => response({ message: 'already exists' }, 422));
  await assert.rejects(getPublisher('linkedin').publish(credentials.linkedin, { text: 'hello', idempotencyKey: 'k' }), errorCode('DUPLICATE', false));
  mock(() => response({ message: 'invalid content' }, 422));
  await assert.rejects(getPublisher('linkedin').publish(credentials.linkedin, { text: 'hello', idempotencyKey: 'k' }), errorCode('CONTENT_REJECTED', false));
});
test('LinkedIn: 401, 429 Retry-After and 5xx mappings', async () => {
  const adapter = getPublisher('linkedin');
  mock(url => url.endsWith('/v2/userinfo') ? response({ error: 'no' }, 401) : response({ error: 'busy' }, 429, { 'Retry-After': '17' }));
  await assert.rejects(adapter.validate(credentials.linkedin), errorCode('AUTH_EXPIRED', false));
  mock(() => response({ error: 'busy' }, 429, { 'Retry-After': '17' }));
  await assert.rejects(adapter.publish(credentials.linkedin, { text: 'hello', idempotencyKey: 'k' }), errorCode('RATE_LIMITED', true, 17));
  mock(() => response({ error: 'down' }, 503));
  await assert.rejects(adapter.publish(credentials.linkedin, { text: 'hello', idempotencyKey: 'k' }), errorCode('PROVIDER_DOWN', true));
});
test('LinkedIn: long text is rejected before HTTP and refresh without token is null', async () => {
  const adapter = getPublisher('linkedin'); const calls = mock();
  await assert.rejects(adapter.publish(credentials.linkedin, { text: 'x'.repeat(3001), idempotencyKey: 'k' }), errorCode('CONTENT_REJECTED', false));
  assert.equal(calls.length, 0); assert.equal(await adapter.refreshCredentials?.({ accessToken: 'test-secret', expiresAt: '1' }), null);
});
test('Facebook: validate Page, text-only feed publish and media warning', async () => {
  const calls = mock((url, init) => {
    if (url.includes('/me?fields=id,name')) {
      assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer test-secret');
      return response({ id: 'page-1', name: 'Test Page' });
    }
    const parsed = new URL(url);
    assert.equal(parsed.pathname, '/v21.0/page-1/feed');
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer test-secret');
    assert.equal(new URLSearchParams(String(init?.body)).get('message'), 'hello');
    return response({ id: 'post-1' });
  });
  const adapter = getPublisher('facebook');
  const c = { accessToken: 'test-secret', externalId: 'page-1' };
  const account = await adapter.validate(c);
  assert.equal(account.externalId, 'page-1');
  assert.equal(account.displayName, 'Test Page');
  assert.equal(account.url, 'https://www.facebook.com/page-1');
  const result = await adapter.publish(c, { text: 'hello', mediaUrls: ['https://image.test/x'], idempotencyKey: 'k' });
  assert.equal(result.remoteId, 'post-1');
  assert.equal(result.url, 'https://www.facebook.com/post-1');
  assert.equal(result.warnings?.length, 1);
  assert.equal(calls.length, 2);
});
test('Facebook: 401, 429 Retry-After, 5xx, long text and missing Page mappings', async () => {
  const adapter = getPublisher('facebook');
  const c = { accessToken: 'test-secret', externalId: 'page-1' };
  mock(() => response({ error: { message: 'expired' } }, 401));
  await assert.rejects(adapter.validate(c), errorCode('AUTH_EXPIRED', false));
  mock(() => response({ error: 'busy' }, 429, { 'Retry-After': '17' }));
  await assert.rejects(adapter.publish(c, { text: 'hello', idempotencyKey: 'k' }), errorCode('RATE_LIMITED', true, 17));
  mock(() => response({ error: 'down' }, 503));
  await assert.rejects(adapter.publish(c, { text: 'hello', idempotencyKey: 'k' }), errorCode('PROVIDER_DOWN', true));
  const calls = mock();
  await assert.rejects(adapter.publish(c, { text: 'x'.repeat(FACEBOOK_TEXT_LIMIT + 1), idempotencyKey: 'k' }), errorCode('CONTENT_REJECTED', false));
  assert.equal(calls.length, 0);
  await assert.rejects(adapter.publish({ accessToken: 'test-secret' }, { text: 'hello', idempotencyKey: 'k' }), errorCode('AUTH_EXPIRED', false));
});
test('Mastodon 404 instance fallback and duplicate mapping', async () => {
  mock(url => url.endsWith('/instance') ? response({}, 404) : url.endsWith('/statuses') ? response({ error: 'duplicate idempotency key' }, 422) : ok(url));
  await assert.rejects(getPublisher('mastodon').publish(credentials.mastodon, { text: 'hi', idempotencyKey: 'k' }), errorCode('DUPLICATE', false));
});
for (const count of [1, 2]) test(`Telegram ${count} images split caption and follow-up`, async () => {
  const calls = mock();
  const text = 'x'.repeat(1023) + '😀' + 'y'.repeat(100);
  await getPublisher('telegram').publish(credentials.telegram, { text, mediaUrls: Array(count).fill('https://image.test/small'), idempotencyKey: 'k' });
  const sends = calls.filter(c => c.init.method === 'POST');
  const first = JSON.parse(String(sends[0].init.body));
  const rest = JSON.parse(String(sends[1].init.body));
  const caption = count === 1 ? first.caption : first.media[0].caption;
  assert.equal(caption.length, 1023); assert.equal(caption + rest.text, text);
  if (count === 2) assert.equal(first.media[1].caption, undefined);
});
test('Telegram body auth errors and retry_after are mapped', async () => {
  for (const description of ['Unauthorized', 'bot was kicked', 'chat not found']) {
    mock(() => response({ ok: false, error_code: 400, description }));
    await assert.rejects(getPublisher('telegram').validate(credentials.telegram), errorCode('AUTH_EXPIRED'));
  }
  mock(() => response({ ok: false, error_code: 429, parameters: { retry_after: 33 } }));
  await assert.rejects(getPublisher('telegram').validate(credentials.telegram), errorCode('RATE_LIMITED', true, 33));
});
test('Telegram partial success returns warning without retrying album', async () => {
  mock(url => url.endsWith('sendMessage') ? response({}, 500) : ok(url));
  const result = await getPublisher('telegram').publish(credentials.telegram, { text: 'x'.repeat(1500), mediaUrls: ['https://image.test/a'], idempotencyKey: 'k' });
  assert.equal(result.remoteId, '42'); assert.equal(result.warnings?.length, 1);
});
test('HTTP sanitizes DNS exceptions and Retry-After dates', async () => {
  globalThis.fetch = async () => { throw new Error('https://test-secret@host'); };
  await assert.rejects(json('Telegram', 'https://example.test'), errorCode('NETWORK', true));
  mock(() => response({}, 429, { 'Retry-After': new Date(Date.now() + 60_000).toUTCString() }));
  await assert.rejects(json('Bluesky', 'https://example.test'), (error: unknown) => { assert.ok(error instanceof PublishError); assert.ok(error.retryAfterSeconds! >= 59); return true; });
});
test('Bluesky discovers external PDS after initial login rejection', async () => {
  const calls = mock(url => {
    if (url === 'https://bsky.social/xrpc/com.atproto.server.createSession') return response({ error: 'AuthenticationRequired' }, 401);
    if (url.includes('resolveHandle')) return response({ did: 'did:plc:alice' });
    if (url.startsWith('https://plc.directory/')) return response({ service: [{ id: '#atproto_pds', serviceEndpoint: 'https://custom.test' }] });
    if (url === 'https://custom.test/xrpc/com.atproto.server.createSession') return response({ ...session, didDoc: { service: [{ id: '#atproto_pds', serviceEndpoint: 'https://custom.test' }] } });
    return ok(url);
  });
  const account = await getPublisher('bluesky').validate(credentials.bluesky);
  assert.equal(account.externalId, 'did:plc:alice');
  assert.equal(calls.at(-1)!.url, 'https://custom.test/xrpc/com.atproto.server.createSession');
});
test('Bluesky AuthenticationRequired in 400 response is AUTH_EXPIRED', async () => {
  mock(() => response({ error: 'AuthenticationRequired' }, 400));
  await assert.rejects(getPublisher('bluesky').validate(credentials.bluesky), errorCode('AUTH_EXPIRED'));
});
test('HTTP maps unsupported media and aborts stalled response bodies', async t => {
  mock(() => response({ error: 'test-secret' }, 422));
  await assert.rejects(json('Bluesky', 'https://example.test'), errorCode('CONTENT_REJECTED', false));
  t.mock.timers.enable({ apis: ['setTimeout'] });
  globalThis.fetch = async () => new Response(new ReadableStream({ start() {} }));
  const pending = json('Telegram', 'https://example.test');
  const checked = assert.rejects(pending, errorCode('NETWORK', true));
  await Promise.resolve(); t.mock.timers.tick(20_000); await checked;
  t.mock.timers.reset();
});

for (const url of ['https://localhost/a', 'https://127.0.0.1/a', 'https://10.0.0.1/a', 'https://172.16.0.1/a', 'https://192.168.1.1/a', 'https://169.254.169.254/a', 'https://[::1]/a', 'https://[::ffff:127.0.0.1]/a', 'https://0/a', 'https://2130706433/a', 'https://[fe80::1]/a', 'https://[fc00::1]/a', 'https://100.64.0.1/a', 'https://224.0.0.1/a', 'https://[ff02::1]/a', 'http://example.com/a']) {
  test('SSRF rejected before fetch: ' + url, async () => { const calls = mock(); await assert.rejects(safeFetch(url), errorCode('CONTENT_REJECTED')); assert.equal(calls.length, 0); });
}
test('mixed DNS answers cannot reach fetch', async () => {
  nodeMock.restoreAll();
  nodeMock.method(dns, 'lookup', async () => [{ address: '93.184.216.34', family: 4 }, { address: '::1', family: 6 }]);
  const calls = mock(); await assert.rejects(safeFetch('https://mixed.test'), errorCode('CONTENT_REJECTED')); assert.equal(calls.length, 0);
});
test('redirect revalidates destination and stream caps JSON', async () => {
  const calls = mock(() => new Response(null, { status: 302, headers: { location: 'https://10.0.0.1' } }));
  await assert.rejects(safeFetch('https://public.test'), errorCode('CONTENT_REJECTED')); assert.equal(calls.length, 1);
  mock(() => new Response(new Uint8Array(65537)));
  await assert.rejects(safeFetch('https://public.test'), errorCode('CONTENT_REJECTED'));
  assert(!publicAddress('::ffff:10.1.2.3'));
});
test('Bluesky reconciliation adopts existing record without uploading or creating', async () => {
  const calls = mock(url => url.includes('getRecord?') ? response({ uri: 'at://did:plc:alice/app.bsky.feed.post/existing' }) : ok(url));
  const result = await getPublisher('bluesky').publish(credentials.bluesky, { text: 'hello', idempotencyKey: 'same-target', mediaUrls: ['https://image.test/a'] });
  assert.equal(result.remoteId, 'at://did:plc:alice/app.bsky.feed.post/existing');
  assert.equal(calls.filter(c => /createRecord|uploadBlob/.test(c.url)).length, 0);
});
test('Bluesky stable valid rkey across retries, Mastodon cold discovery and persisted meta', async () => {
  let calls = mock();
  for (let n = 0; n < 2; n++) await getPublisher('bluesky').publish(credentials.bluesky, { text: 'hi', idempotencyKey: 'same-target' });
  const keys = calls.filter(c => c.url.endsWith('createRecord')).map(c => JSON.parse(String(c.init.body)).rkey);
  assert.equal(keys[0], keys[1]); assert.match(keys[0], /^[a-z0-9]{32}$/);
  calls = mock(url => url.endsWith('/instance') ? response({ configuration: { statuses: { max_characters: 1000 } } }) : ok(url));
  const creds = { ...credentials.mastodon, instanceUrl: 'https://cold.test' };
  await getPublisher('mastodon').publish(creds, { text: 'x'.repeat(800), idempotencyKey: 'same-target' });
  assert.equal((await getPublisher('mastodon').validate(creds)).meta?.maxTextLength, 1000);
  assert(calls.some(c => c.url.endsWith('/statuses')));
});

test('real TLS connector pins checked IP, preserves SNI and verifies certificates', async () => {
  const { mkdtempSync, readFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { execFileSync } = await import('node:child_process');
  const tls = await import('node:tls');
  const { pinnedAgent } = await import('../lib/publishers/safe-fetch');
  const dir = mkdtempSync(tmpdir() + '/socialmint-pin-');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', dir + '/key', '-out', dir + '/cert', '-days', '1', '-subj', '/CN=pin.test'], { stdio: 'ignore' });
  const options = { key: readFileSync(dir + '/key'), cert: readFileSync(dir + '/cert') };
  let sni = '';
  const server = tls.createServer({ ...options, SNICallback: (name, cb) => { sni = name; cb(null, tls.createSecureContext(options)); } });
  server.on('tlsClientError', () => {});
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  // Test the connector in isolation: production only constructs it after URL validation.
  const agent = pinnedAgent('pin.test', [{ address: '127.0.0.1', family: 4 }]);
  globalThis.fetch = originalFetch;
  try {
    const address = server.address() as { port: number };
    await assert.rejects(fetch(`https://pin.test:${address.port}`, { dispatcher: agent } as RequestInit), (error: unknown) => {
      assert.equal((error as Error & { cause: { code: string } }).cause.code, 'DEPTH_ZERO_SELF_SIGNED_CERT'); return true;
    });
    assert.equal(sni, 'pin.test'); // Reached the pinned local socket, without resolving pin.test.
  } finally { await agent.destroy(); await new Promise<void>(resolve => server.close(() => resolve())); rmSync(dir, { recursive: true }); }
});

test('90-second publish deadline spans successive requests and aborts later work', async t => {
  const { publishingDeadline, pollingPause } = await import('../lib/publishers/http');
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let finished = false;
  const task = publishingDeadline(async () => {
    for (let i = 0; i < 100; i++) await pollingPause();
    finished = true;
  });
  const checked = assert.rejects(task, errorCode('NETWORK', true));
  for (let i = 0; i < 90; i++) { t.mock.timers.tick(1000); await Promise.resolve(); await Promise.resolve(); }
  await checked; assert.equal(finished, false); t.mock.timers.reset();
});

test('Mastodon repeats the same idempotency key and adopts the same remote status', async () => {
  const statuses = new Map<string, { id: string; url: string }>();
  const calls = mock((url, init) => {
    if (!url.endsWith('/statuses')) return ok(url);
    const key = new Headers(init?.headers).get('Idempotency-Key')!;
    if (!statuses.has(key)) statuses.set(key, { id: 'remote-' + statuses.size, url: 'https://mastodon.test/status' });
    return response(statuses.get(key));
  });
  const input = { text: 'Same post after a lost commit', idempotencyKey: 'persistent-target' };
  const first = await getPublisher('mastodon').publish(credentials.mastodon, input);
  const second = await getPublisher('mastodon').publish(credentials.mastodon, input);
  assert.equal(first.remoteId, second.remoteId);
  assert.equal(statuses.size, 1);
  assert.equal(calls.filter(c => c.url.endsWith('/statuses')).length, 2);
});

for (const provider of ['x', 'threads'] as const) {
  test(`${provider}: OAuth validate and 401, rate reset and provider outage`, async () => {
    const adapter = getPublisher(provider), c = { accessToken: 'test-secret' };
    mock(() => response(provider === 'x' ? { data: { id: '42', username: 'alice' } } : { id: '42', username: 'alice' }));
    assert.equal((await adapter.validate(c)).externalId, '42');
    mock(() => response({}, 401)); await assert.rejects(adapter.validate(c), errorCode('AUTH_EXPIRED', false));
    mock(() => response({}, 429, { 'x-rate-limit-reset': String(Math.ceil(Date.now() / 1000) + 120) }));
    await assert.rejects(adapter.validate(c), (e: unknown) => { assert(e instanceof PublishError); assert.equal(e.code, 'RATE_LIMITED'); assert(e.retryAfterSeconds! >= 120 && e.retryAfterSeconds! <= 121); return true; });
    mock(() => response({}, 503)); await assert.rejects(adapter.validate(c), errorCode('PROVIDER_DOWN', true));
  });
}
test('X publishes weighted URLs and four uploaded media IDs; rejects long content and duplicates', async () => {
  const { countXText } = await import('../lib/text-limits');
  assert.equal(countXText('a'.repeat(256) + ' https://example.com/' + 'b'.repeat(300)), 280);
  assert.equal(countXText('界😀'), 4);
  const calls = mock(url => url.includes('image.test') ? new Response('image', { headers: { 'content-type': 'image/png' } }) : response(url.endsWith('/media/upload') ? { data: { id: 'media1' } } : { data: { id: 'post1' } }));
  const text = 'a'.repeat(256) + ' https://example.com/' + 'b'.repeat(300);
  const result = await getPublisher('x').publish({ accessToken: 'test-secret' }, { text, mediaUrls: Array(4).fill('https://image.test/img.png'), idempotencyKey: 'one' });
  assert.equal(result.remoteId, 'post1');
  assert.deepEqual(JSON.parse(String(calls.at(-1)!.init.body)), { text, media: { media_ids: Array(4).fill('media1') } });
  assert.deepEqual(JSON.parse(String(calls[1].init.body)), { media: Buffer.from('image').toString('base64'), media_type: 'image/png', media_category: 'tweet_image' });
  await assert.rejects(getPublisher('x').publish({ accessToken: 'test-secret' }, { text: 'a'.repeat(281), idempotencyKey: 'long' }), errorCode('CONTENT_REJECTED'));
  mock(() => response({ detail: 'duplicate content' }, 403));
  await assert.rejects(getPublisher('x').publish({ accessToken: 'test-secret' }, { text: 'hi', idempotencyKey: 'dup' }), errorCode('DUPLICATE', false));
});
test('X refresh rotates tokens, honors expiry, fails closed', async () => {
  process.env.X_CLIENT_ID = 'test-client'; process.env.X_CLIENT_SECRET = 'test-secret';
  try {
    const calls = mock(() => response({ access_token: 'new-token', refresh_token: 'new-refresh', expires_in: 7200 }));
    const adapter = getPublisher('x');
    const c = { accessToken: 'test-secret', refreshToken: 'old-refresh', expiresAt: String(Date.now() + 1000) };
    const fresh = await adapter.refreshCredentials!(c);
    assert.equal(fresh?.refreshToken, 'new-refresh'); assert(Number(fresh?.expiresAt) > Date.now());
    assert.equal(new URLSearchParams(String(calls[0].init.body)).get('grant_type'), 'refresh_token');
    assert.equal(await adapter.refreshCredentials!(fresh!), null);
    mock(() => response({ error: 'invalid_grant' }, 400));
    await assert.rejects(adapter.refreshCredentials!(c), errorCode('AUTH_EXPIRED'));
  } finally { delete process.env.X_CLIENT_ID; delete process.env.X_CLIENT_SECRET; }
});
test('Threads text, image and carousel containers publish only after processing', async () => {
  for (const images of [[], ['https://image.test/1.png'], ['https://image.test/1.png', 'https://image.test/2.png']]) {
    let sequence = 0;
    const calls = mock(url => url.includes('image.test') ? ok(url) : response(url.includes('fields=status') ? { status: 'FINISHED' } : { id: String(++sequence) }));
    await getPublisher('threads').publish({ accessToken: 'test-secret' }, { text: 'hello', mediaUrls: images, idempotencyKey: 'threads' });
    const writes = calls.filter(c => c.init.method === 'POST').map(c => ({ path: new URL(c.url).pathname, body: Object.fromEntries(new URLSearchParams(String(c.init.body))) }));
    assert.equal(writes.at(-1)?.path, '/v1.0/me/threads_publish');
    assert.deepEqual(writes.at(-1)?.body, { creation_id: String(images.length > 1 ? 3 : 1) });
    const parent = writes.at(-2)!.body;
    assert.equal(parent.text, 'hello'); assert.equal(parent.media_type, images.length > 1 ? 'CAROUSEL' : images.length ? 'IMAGE' : 'TEXT');
    if (images.length > 1) { assert.equal(parent.children, '1,2'); assert.equal(writes[0].body.is_carousel_item, 'true'); }
    if (images.length === 1) assert.equal(parent.image_url, images[0]);
  }
});
test('Threads refresh extends long-lived tokens and refuses expired ones', async () => {
  const calls = mock(() => response({ access_token: 'renewed', expires_in: 5184000 }));
  const adapter = getPublisher('threads'), c = { accessToken: 'test-secret', expiresAt: String(Date.now() + 86400000), issuedAt: String(Date.now() - 2 * 86400000) };
  const renewed = await adapter.refreshCredentials!(c);
  assert.equal(renewed?.accessToken, 'renewed'); assert(calls[0].url.includes('/refresh_access_token?grant_type=th_refresh_token'));
  assert.equal(await adapter.refreshCredentials!(renewed!), null);
  await assert.rejects(adapter.refreshCredentials!({ ...c, expiresAt: '1' }), errorCode('AUTH_EXPIRED'));
});

for (const provider of ['x','bluesky','mastodon','telegram','threads','linkedin','facebook'] as const) test(`${provider} adapter download limit is honored without a global cap`, async () => {
  const adapter = getPublisher(provider), limit = adapter.maxMediaBytes;
  const {downloadImage} = await import('../lib/publishers/http');
  mock(() => new Response(new Uint8Array(limit),{headers:{'content-type':'image/png'}}));
  assert.equal((await downloadImage(provider,'https://image.test/limit',limit)).size,limit);
  mock(() => new Response(new Uint8Array(limit+1),{headers:{'content-type':'image/png'}}));
  await assert.rejects(downloadImage(provider,'https://image.test/over',limit), errorCode('CONTENT_REJECTED',false));
});
