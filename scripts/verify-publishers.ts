// Run: npx tsx --test scripts/verify-publishers.ts (all HTTP is mocked).
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { availableProviders, getPublisher, PublishError, type Credentials } from '../lib/publishers';
import { json } from '../lib/publishers/http';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const credentials: Record<string, Credentials> = {
  bluesky: { identifier: 'alice.test', appPassword: 'test-secret' },
  mastodon: { instanceUrl: 'https://mastodon.test', accessToken: 'test-secret' },
  telegram: { botToken: 'test-secret', chatId: '@channel' },
};
const session = { did: 'did:plc:alice', handle: 'alice.test', accessJwt: 'temporary-secret', didDoc: { service: [{ id: '#atproto_pds', serviceEndpoint: 'https://bsky.social' }] } };
const message = { message_id: 42, chat: { id: -123, username: 'channel' } };
function response(body: unknown, status = 200, headers: HeadersInit = {}) { return new Response(JSON.stringify(body), { status, headers }); }
function ok(url: string): Response {
  if (url.endsWith('createSession')) return response(session);
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

test('registry loads all three providers', () => assert.deepEqual(availableProviders().sort(), ['bluesky', 'mastodon', 'telegram']));
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
    assert.equal(calls.length, 0);
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
  assert.equal(calls[2].url, 'https://custom.test/xrpc/com.atproto.repo.createRecord');
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
  const result = await getPublisher('bluesky').publish(credentials.bluesky, { text: 'hello', mediaUrls: ['https://image.test/large', 'https://image.test/small'], idempotencyKey: 'k' });
  assert.equal(result.warnings?.length, 1);
  assert.equal(JSON.parse(String(calls.at(-1)!.init.body)).record.embed.images.length, 1);
});
test('Mastodon polls async media and attaches IDs', async () => {
  let polls = 0;
  const calls = mock(url => {
    if (url === 'https://image.test/small') return new Response('image', { headers: { 'Content-Type': 'image/png' } });
    if (url.endsWith('/api/v2/media')) return response({ id: 'media1', url: null }, 202);
    if (url.endsWith('/api/v1/media/media1')) { polls++; return polls === 1 ? new Response(null, { status: 206 }) : response({ id: 'media1', url: 'https://image.test/ready' }); }
    return ok(url);
  });
  await getPublisher('mastodon').publish(credentials.mastodon, { text: 'hi', mediaUrls: ['https://image.test/small'], idempotencyKey: 'k' });
  assert.equal(polls, 2);
  assert.ok(calls.find(c => c.url.endsWith('/api/v2/media'))!.init.body instanceof FormData);
  assert.deepEqual(JSON.parse(String(calls.at(-1)!.init.body)).media_ids, ['media1']);
});
test('Mastodon caches discovered limit for preflight', async () => {
  const creds = { ...credentials.mastodon, instanceUrl: 'https://large.test' };
  mock(url => url.endsWith('/instance') ? response({ configuration: { statuses: { max_characters: 1000 } } }) : ok(url));
  await getPublisher('mastodon').validate(creds);
  await getPublisher('mastodon').publish(creds, { text: 'x'.repeat(800), idempotencyKey: 'k' });
  const calls = mock();
  await assert.rejects(getPublisher('mastodon').publish(creds, { text: 'x'.repeat(1001), idempotencyKey: 'k' }), errorCode('CONTENT_REJECTED'));
  assert.equal(calls.length, 0);
});
test('Mastodon 404 instance fallback and duplicate mapping', async () => {
  mock(url => url.endsWith('/instance') ? response({}, 404) : url.endsWith('/statuses') ? response({ error: 'duplicate idempotency key' }, 422) : ok(url));
  await assert.rejects(getPublisher('mastodon').publish(credentials.mastodon, { text: 'hi', idempotencyKey: 'k' }), errorCode('DUPLICATE', false));
});
for (const count of [1, 2]) test(`Telegram ${count} images split caption and follow-up`, async () => {
  const calls = mock();
  const text = 'x'.repeat(1023) + '😀' + 'y'.repeat(100);
  await getPublisher('telegram').publish(credentials.telegram, { text, mediaUrls: Array(count).fill('https://image.test/small'), idempotencyKey: 'k' });
  const first = JSON.parse(String(calls[0].init.body));
  const rest = JSON.parse(String(calls[1].init.body));
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
