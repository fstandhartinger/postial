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
import { INSTAGRAM_TEXT_LIMIT } from '../lib/publishers/instagram';
import { TIKTOK_TEXT_LIMIT, tiktokChunkPlan } from '../lib/publishers/tiktok';
import { fetchTargetMetrics, metricsRefreshIntervalMs, refreshMetricsTick } from '../lib/metrics/refresh';
import { compareMetricHistory } from '../lib/metrics/compare';
import { encryptCredentials } from '../lib/crypto';
import { postMetrics } from '../db/schema';

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
test('Instagram: validate Business account and single-image publish', async () => {
  const calls = mock((url, init) => {
    if (url.includes('image.test')) return new Response('image', { headers: { 'content-type': 'image/png' } });
    if (url.includes('/ig-account?')) {
      assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer test-secret');
      return response({ id: 'ig-account', username: 'postial.test' });
    }
    if (url.includes('/ig-account/media') && !url.includes('media_publish')) {
      const body = new URLSearchParams(String(init?.body));
      assert.equal(body.get('image_url'), 'https://image.test/one.png');
      assert.equal(body.get('caption'), 'hello');
      return response({ id: 'container-1' });
    }
    if (url.includes('/container-1?fields=status_code')) return response({ status_code: 'FINISHED' });
    if (url.endsWith('/ig-account/media_publish')) {
      assert.equal(new URLSearchParams(String(init?.body)).get('creation_id'), 'container-1');
      return response({ id: 'media-9' });
    }
    throw new Error(`Unexpected mock route: ${url}`);
  });
  const adapter = getPublisher('instagram');
  const c = { accessToken: 'test-secret', externalId: 'ig-account' };
  const account = await adapter.validate(c);
  assert.equal(account.externalId, 'ig-account');
  assert.equal(account.displayName, '@postial.test');
  assert.equal(account.url, 'https://www.instagram.com/postial.test/');
  const result = await adapter.publish(c, { text: 'hello', mediaUrls: ['https://image.test/one.png'], idempotencyKey: 'k' });
  assert.equal(result.remoteId, 'media-9');
  assert.equal(calls.filter(call => call.url.endsWith('/ig-account/media')).length, 1);
});
test('Instagram: carousel children then parent, and text-only is rejected', async () => {
  const created: { body: URLSearchParams }[] = [];
  mock((url, init) => {
    if (url.includes('image.test')) return new Response('image', { headers: { 'content-type': 'image/png' } });
    if (url.includes('/media_publish')) return response({ id: 'media-carousel' });
    if (url.includes('/media')) { created.push({ body: new URLSearchParams(String(init?.body)) }); return response({ id: `container-${created.length}` }); }
    if (url.includes('fields=status_code')) return response({ status_code: 'FINISHED' });
    throw new Error(`Unexpected mock route: ${url}`);
  });
  const adapter = getPublisher('instagram');
  const c = { accessToken: 'test-secret', externalId: 'ig-account' };
  const result = await adapter.publish(c, { text: 'album', mediaUrls: ['https://image.test/a.png', 'https://image.test/b.png'], idempotencyKey: 'k' });
  assert.equal(result.remoteId, 'media-carousel');
  assert.equal(created[0].body.get('is_carousel_item'), 'true');
  assert.equal(created[0].body.get('caption'), null);
  const parent = created.at(-1)!;
  assert.equal(parent.body.get('media_type'), 'CAROUSEL');
  assert.equal(parent.body.get('caption'), 'album');
  assert.equal(parent.body.get('children'), 'container-1,container-2');
  const calls = mock();
  await assert.rejects(adapter.publish(c, { text: 'no image', idempotencyKey: 'k' }), errorCode('CONTENT_REJECTED', false));
  assert.equal(calls.length, 0);
});
test('Instagram: 401, 429 Retry-After, 5xx, long caption and missing Business account mappings', async () => {
  const adapter = getPublisher('instagram');
  const c = { accessToken: 'test-secret', externalId: 'ig-account' };
  const imageOnly = (status: number, headers: HeadersInit = {}) => mock((url: string) => url.includes('image.test') ? new Response('image', { headers: { 'content-type': 'image/png' } }) : response({ error: 'x' }, status, headers));
  mock(() => response({ error: { message: 'expired' } }, 401));
  await assert.rejects(adapter.validate(c), errorCode('AUTH_EXPIRED', false));
  imageOnly(429, { 'Retry-After': '17' });
  await assert.rejects(adapter.publish(c, { text: 'hello', mediaUrls: ['https://image.test/a.png'], idempotencyKey: 'k' }), errorCode('RATE_LIMITED', true, 17));
  imageOnly(503);
  await assert.rejects(adapter.publish(c, { text: 'hello', mediaUrls: ['https://image.test/a.png'], idempotencyKey: 'k' }), errorCode('PROVIDER_DOWN', true));
  const calls = mock();
  await assert.rejects(adapter.publish(c, { text: 'x'.repeat(INSTAGRAM_TEXT_LIMIT + 1), mediaUrls: ['https://image.test/a.png'], idempotencyKey: 'k' }), errorCode('CONTENT_REJECTED', false));
  assert.equal(calls.length, 0);
  await assert.rejects(adapter.publish({ accessToken: 'test-secret' }, { text: 'hello', mediaUrls: ['https://image.test/a.png'], idempotencyKey: 'k' }), errorCode('AUTH_EXPIRED', false));
});
test('TikTok chunk plan honors TikTok chunk restrictions', () => {
  assert.deepEqual(tiktokChunkPlan(0), { chunkSize: 0, totalChunks: 0 });
  assert.deepEqual(tiktokChunkPlan(4_194_304), { chunkSize: 4_194_304, totalChunks: 1 });
  assert.deepEqual(tiktokChunkPlan(5_000_000), { chunkSize: 5_000_000, totalChunks: 1 });
  assert.deepEqual(tiktokChunkPlan(50_000_123), { chunkSize: 50_000_123, totalChunks: 1 });
  assert.deepEqual(tiktokChunkPlan(125_829_121), { chunkSize: 62_914_560, totalChunks: 2 });
  assert.deepEqual(tiktokChunkPlan(600_000_000), { chunkSize: 60_000_000, totalChunks: 10 });
  for (const size of [5_000_001, 64_000_000, 64_000_001, 128_000_000, 128_000_001, 256_000_001, 1_000_000_000, 4_000_000_000]) {
    const plan = tiktokChunkPlan(size);
    assert.ok(plan.totalChunks >= 1 && plan.totalChunks <= 1000, `chunk count for ${size}`);
    assert.ok(plan.chunkSize >= 5_000_000 && plan.chunkSize <= 64_000_000, `chunk size ${plan.chunkSize} for ${size}`);
    const last = size - (plan.totalChunks - 1) * plan.chunkSize;
    assert.ok(last >= 1 && last <= 128_000_000, `final chunk ${last} for ${size}`);
  }
});
test('TikTok: validate account and single-chunk video publish with SELF_ONLY', async () => {
  const calls = mock((url, init) => {
    if (url.includes('video.test')) return new Response(new Uint8Array(12), { headers: { 'content-type': 'video/mp4' } });
    if (url.includes('/v2/user/info/')) {
      assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer test-secret');
      return response({ data: { user: { open_id: 'tt-account', display_name: 'Postial Test' } } });
    }
    if (url.endsWith('/v2/post/publish/creator_info/query/')) return response({ data: { privacy_level_options: ['SELF_ONLY'] } });
    if (url.endsWith('/v2/post/publish/video/init/')) {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.post_info.title, 'hello');
      assert.equal(body.post_info.privacy_level, 'SELF_ONLY');
      assert.equal(body.source_info.source, 'FILE_UPLOAD');
      assert.equal(body.source_info.video_size, 12);
      assert.equal(body.source_info.chunk_size, 12);
      assert.equal(body.source_info.total_chunk_count, 1);
      return response({ data: { publish_id: 'pub-1', upload_url: 'https://upload.tiktok.test/video/?upload_id=1' } });
    }
    if (url.startsWith('https://upload.tiktok.test/')) {
      const headers = new Headers(init?.headers);
      assert.equal(headers.get('Content-Range'), 'bytes 0-11/12');
      assert.equal(headers.get('Content-Type'), 'video/mp4');
      return new Response(null, { status: 201 });
    }
    if (url.endsWith('/v2/post/publish/status/fetch/')) {
      assert.equal(JSON.parse(String(init?.body)).publish_id, 'pub-1');
      return response({ data: { status: 'PUBLISH_COMPLETE' } });
    }
    throw new Error(`Unexpected mock route: ${url}`);
  });
  const adapter = getPublisher('tiktok');
  const c = { accessToken: 'test-secret', externalId: 'tt-account' };
  const account = await adapter.validate(c);
  assert.equal(account.externalId, 'tt-account');
  assert.equal(account.displayName, 'Postial Test');
  const result = await adapter.publish(c, { text: 'hello', mediaUrls: ['https://video.test/clip.mp4'], idempotencyKey: 'k' });
  assert.equal(result.remoteId, 'pub-1');
  assert.equal(calls.filter(call => call.url.startsWith('https://upload.tiktok.test/')).length, 1);
});
test('TikTok: multi-chunk upload sends sequential Content-Range parts and adopts the public post id', async () => {
  const size = 125_829_121;
  const plan = tiktokChunkPlan(size);
  const ranges: string[] = [];
  let uploadCalls = 0;
  mock((url, init) => {
    if (url.includes('video.test')) return new Response(new Uint8Array(size), { headers: { 'content-type': 'video/mp4' } });
    if (url.endsWith('/v2/post/publish/creator_info/query/')) return response({ data: { privacy_level_options: ['SELF_ONLY'] } });
    if (url.endsWith('/v2/post/publish/video/init/')) {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.source_info.video_size, size);
      assert.equal(body.source_info.chunk_size, plan.chunkSize);
      assert.equal(body.source_info.total_chunk_count, plan.totalChunks);
      return response({ data: { publish_id: 'pub-2', upload_url: 'https://upload.tiktok.test/video/?upload_id=2' } });
    }
    if (url.startsWith('https://upload.tiktok.test/')) {
      ranges.push(new Headers(init?.headers).get('Content-Range')!);
      uploadCalls++;
      return new Response(null, { status: uploadCalls === plan.totalChunks ? 201 : 206 });
    }
    if (url.endsWith('/v2/post/publish/status/fetch/')) return response({ data: { status: 'PUBLISH_COMPLETE', publicaly_available_post_id: [777] } });
    throw new Error(`Unexpected mock route: ${url}`);
  });
  const result = await getPublisher('tiktok').publish({ accessToken: 'test-secret' }, { text: 'album', mediaUrls: ['https://video.test/big.mp4'], idempotencyKey: 'k' });
  assert.equal(result.remoteId, '777');
  assert.equal(uploadCalls, plan.totalChunks);
  let offset = 0;
  for (const range of ranges) {
    const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(range)!;
    assert.equal(Number(match[1]), offset);
    offset = Number(match[2]) + 1;
    assert.equal(Number(match[3]), size);
  }
  assert.equal(offset, size);
});
test('TikTok: FAILED status maps fail reasons to reconnect, retry and content errors', async () => {
  const adapter = getPublisher('tiktok');
  const c = { accessToken: 'test-secret' };
  const failFlow = (failReason: string) => mock(url => {
    if (url.includes('video.test')) return new Response(new Uint8Array(12), { headers: { 'content-type': 'video/mp4' } });
    if (url.endsWith('/v2/post/publish/creator_info/query/')) return response({ data: { privacy_level_options: ['SELF_ONLY'] } });
    if (url.endsWith('/v2/post/publish/video/init/')) return response({ data: { publish_id: 'pub-3', upload_url: 'https://upload.tiktok.test/video/?upload_id=3' } });
    if (url.startsWith('https://upload.tiktok.test/')) return new Response(null, { status: 201 });
    if (url.endsWith('/v2/post/publish/status/fetch/')) return response({ data: { status: 'FAILED', fail_reason: failReason } });
    throw new Error(`Unexpected mock route: ${url}`);
  });
  failFlow('duration_check_failed');
  await assert.rejects(adapter.publish(c, { text: 'hi', mediaUrls: ['https://video.test/a.mp4'], idempotencyKey: 'k' }), errorCode('CONTENT_REJECTED', false));
  failFlow('internal');
  await assert.rejects(adapter.publish(c, { text: 'hi', mediaUrls: ['https://video.test/a.mp4'], idempotencyKey: 'k' }), errorCode('PROVIDER_DOWN', true));
  failFlow('auth_removed');
  await assert.rejects(adapter.publish(c, { text: 'hi', mediaUrls: ['https://video.test/a.mp4'], idempotencyKey: 'k' }), errorCode('AUTH_EXPIRED', false));
});
test('TikTok: text-only and image-only rejected, caption over 2200 rejected before HTTP', async () => {
  const adapter = getPublisher('tiktok');
  const c = { accessToken: 'test-secret' };
  let calls = mock();
  await assert.rejects(adapter.publish(c, { text: 'no video', idempotencyKey: 'k' }), error => {
    assert(error instanceof PublishError); assert.equal(error.code, 'CONTENT_REJECTED');
    assert.match(error.humanMessage, /TikTok requires a video/); return true;
  });
  assert.equal(calls.length, 0);
  calls = mock(url => url.includes('image.test') ? new Response('image', { headers: { 'content-type': 'image/png' } }) : response({}));
  await assert.rejects(adapter.publish(c, { text: 'image only', mediaUrls: ['https://image.test/a.png'], idempotencyKey: 'k' }), error => {
    assert(error instanceof PublishError); assert.equal(error.code, 'CONTENT_REJECTED');
    assert.match(error.humanMessage, /video content type/); return true;
  });
  calls = mock();
  await assert.rejects(adapter.publish(c, { text: 'x'.repeat(TIKTOK_TEXT_LIMIT + 1), mediaUrls: ['https://video.test/a.mp4'], idempotencyKey: 'k' }), errorCode('CONTENT_REJECTED', false));
  assert.equal(calls.length, 0);
});
test('TikTok: 401, 429 Retry-After, 5xx and unaudited private-only mappings', async () => {
  const adapter = getPublisher('tiktok');
  const c = { accessToken: 'test-secret' };
  const videoThen = (status: number, headers: HeadersInit = {}, errorBody: unknown = { error: 'x' }) => mock(url => url.includes('video.test') ? new Response(new Uint8Array(12), { headers: { 'content-type': 'video/mp4' } }) : response(errorBody, status, headers));
  mock(() => response({ error: { code: 'access_token_invalid' } }, 401));
  await assert.rejects(adapter.validate(c), errorCode('AUTH_EXPIRED', false));
  videoThen(429, { 'Retry-After': '17' }, { error: { code: 'rate_limit_exceeded' } });
  await assert.rejects(adapter.publish(c, { text: 'hi', mediaUrls: ['https://video.test/a.mp4'], idempotencyKey: 'k' }), errorCode('RATE_LIMITED', true, 17));
  videoThen(503);
  await assert.rejects(adapter.publish(c, { text: 'hi', mediaUrls: ['https://video.test/a.mp4'], idempotencyKey: 'k' }), errorCode('PROVIDER_DOWN', true));
  videoThen(403, {}, { error: { code: 'unaudited_client_can_only_post_to_private_accounts', message: 'Unaudited clients can only post to a private account.' } });
  await assert.rejects(adapter.publish(c, { text: 'hi', mediaUrls: ['https://video.test/a.mp4'], idempotencyKey: 'k' }), error => {
    assert(error instanceof PublishError); assert.equal(error.code, 'CONTENT_REJECTED');
    assert.match(error.humanMessage, /private posts until the Postial app passes TikTok's audit/); return true;
  });
});
test('TikTok refresh rotates tokens, honors expiry, fails closed', async () => {
  process.env.TIKTOK_CLIENT_KEY = 'local-tiktok'; process.env.TIKTOK_CLIENT_SECRET = 'local-tiktok-secret';
  try {
    const calls = mock(() => response({ access_token: 'tiktok-new', refresh_token: 'tiktok-new-refresh', expires_in: 86400, open_id: 'tt-account' }));
    const adapter = getPublisher('tiktok');
    const c = { accessToken: 'test-secret', refreshToken: 'old-refresh', expiresAt: String(Date.now() + 1000) };
    const fresh = await adapter.refreshCredentials!(c);
    assert.equal(fresh?.accessToken, 'tiktok-new'); assert.equal(fresh?.refreshToken, 'tiktok-new-refresh'); assert(Number(fresh?.expiresAt) > Date.now());
    const sent = new URLSearchParams(String(calls[0].init.body));
    assert.equal(sent.get('grant_type'), 'refresh_token');
    assert.equal(sent.get('client_key'), 'local-tiktok');
    assert.equal(sent.get('refresh_token'), 'old-refresh');
    assert.equal(await adapter.refreshCredentials!(fresh!), null);
    mock(() => response({ error: 'invalid_grant' }, 400));
    await assert.rejects(adapter.refreshCredentials!(c), errorCode('AUTH_EXPIRED'));
  } finally { delete process.env.TIKTOK_CLIENT_KEY; delete process.env.TIKTOK_CLIENT_SECRET; }
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

for (const provider of ['x','bluesky','mastodon','telegram','threads','linkedin','facebook','instagram','tiktok'] as const) test(`${provider} adapter download limit is honored without a global cap`, async () => {
  const adapter = getPublisher(provider), limit = adapter.maxMediaBytes;
  const {downloadImage} = await import('../lib/publishers/http');
  mock(() => new Response(new Uint8Array(limit),{headers:{'content-type':'image/png'}}));
  assert.equal((await downloadImage(provider,'https://image.test/limit',limit)).size,limit);
  mock(() => new Response(new Uint8Array(limit+1),{headers:{'content-type':'image/png'}}));
  await assert.rejects(downloadImage(provider,'https://image.test/over',limit), errorCode('CONTENT_REJECTED',false));
});

// --- Per-post metrics (AN-1 / AN-3) -------------------------------------------------
test('Bluesky fetchMetrics parses counts into the right columns and leaves impressions absent', async () => {
  const uri = 'at://did:plc:alice/app.bsky.feed.post/key';
  const calls = mock(url => url.includes('/xrpc/app.bsky.feed.getPosts?') ? response({ posts: [{ uri, likeCount: 12, repostCount: 3, replyCount: 5, quoteCount: 1 }] }) : ok(url));
  const result = await getPublisher('bluesky').fetchMetrics!(credentials.bluesky, uri);
  assert.deepEqual(result, { likes: 12, replies: 5, reposts: 3, quotes: 1, impressions: null });
  // getPosts is an XRPC query: GET with the `uris` parameter (the real API answers POST with
  // "Incorrect HTTP method (POST) expected GET"), on the public AppView, without a login.
  assert.equal(calls.length, 1);
  const call = calls[0];
  const url = new URL(call.url);
  assert.equal(url.origin + url.pathname, 'https://public.api.bsky.app/xrpc/app.bsky.feed.getPosts');
  assert.deepEqual(url.searchParams.getAll('uris'), [uri]);
  assert(!call.init.method || call.init.method === 'GET');
  assert.equal(call.init.body, undefined);
  assert.equal(new Headers(call.init.headers).get('Authorization'), null);
});
test('Mastodon fetchMetrics maps favourites/reblogs/replies and leaves absent fields null', async () => {
  const calls = mock(url => url.endsWith('/api/v1/statuses/8') ? response({ id: '8', favourites_count: 7, reblogs_count: 2, replies_count: 4 }) : ok(url));
  const result = await getPublisher('mastodon').fetchMetrics!(credentials.mastodon, '8');
  assert.deepEqual(result, { likes: 7, replies: 4, reposts: 2, quotes: null, impressions: null });
  const statusCalls = calls.filter(c => c.url.endsWith('/api/v1/statuses/8'));
  // A public status is read without the token (the connect guide grants no read:statuses scope).
  assert.equal(statusCalls.length, 1);
  assert.equal(new Headers(statusCalls[0].init.headers).get('Authorization'), null);
  assert.equal(statusCalls[0].init.method, undefined);
});
test('Mastodon fetchMetrics retries with the token only when the anonymous read is refused', async () => {
  const calls = mock((url, init) => url.endsWith('/api/v1/statuses/9')
    ? (new Headers(init?.headers).get('Authorization') ? response({ id: '9', favourites_count: 1, reblogs_count: 0, replies_count: 0 }) : response({ error: 'Record not found' }, 404))
    : ok(url));
  const result = await getPublisher('mastodon').fetchMetrics!(credentials.mastodon, '9');
  assert.deepEqual(result, { likes: 1, replies: 0, reposts: 0, quotes: null, impressions: null });
  const statusCalls = calls.filter(c => c.url.endsWith('/api/v1/statuses/9'));
  assert.deepEqual(statusCalls.map(c => new Headers(c.init.headers).get('Authorization')), [null, 'Bearer test-secret']);
});
test('Mastodon fetchMetrics: quotes_count is reported on 4.5+, a sick instance is not retried with the token, a hidden post never reads as expired access', async () => {
  let calls = mock(url => url.endsWith('/api/v1/statuses/10') ? response({ id: '10', favourites_count: 3, reblogs_count: 1, replies_count: 0, quotes_count: 2 }) : ok(url));
  assert.deepEqual(await getPublisher('mastodon').fetchMetrics!(credentials.mastodon, '10'), { likes: 3, replies: 0, reposts: 1, quotes: 2, impressions: null });
  calls = mock(url => url.endsWith('/api/v1/statuses/11') ? response({ error: 'down' }, 503) : ok(url));
  await assert.rejects(getPublisher('mastodon').fetchMetrics!(credentials.mastodon, '11'), errorCode('PROVIDER_DOWN'));
  assert.equal(calls.filter(c => c.url.endsWith('/api/v1/statuses/11')).length, 1);
  calls = mock((url, init) => url.endsWith('/api/v1/statuses/12')
    ? (new Headers(init?.headers).get('Authorization') ? response({ error: 'This action is outside the authorized scopes' }, 403) : response({ error: 'Record not found' }, 404))
    : ok(url));
  const fetched = await fetchTargetMetrics(getPublisher('mastodon'), credentials.mastodon, '12');
  assert.deepEqual(fetched, { outcome: 'provider_error', metrics: null });
  assert.equal(calls.filter(c => c.url.endsWith('/api/v1/statuses/12')).length, 2);
});
test('metrics refresh: a tick stops fetching once its time budget is spent', async () => {
  process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
  const now = new Date();
  const credentialsEnc = encryptCredentials({ instanceUrl: 'https://mastodon.example', accessToken: 'test-secret' });
  const candidates = [1, 2, 3].map(n => ({ targetId: crypto.randomUUID(), remoteId: String(n), publishedAt: new Date(now.getTime() - 3_600_000), provider: 'mastodon', credentialsEnc }));
  const db = fakeMetricsDb(candidates, [], []);
  mock(url => response({ id: url.split('/').pop(), favourites_count: 1, reblogs_count: 0, replies_count: 0 }));
  assert.equal(await refreshMetricsTick(db as never, 0), 0);
  assert.equal(db.writes.length, 0);
});
test('metrics: a provider-reported zero stays 0 and is distinguishable from absence', async () => {
  mock(url => url.includes('/xrpc/app.bsky.feed.getPosts?') ? response({ posts: [{ uri: 'at://did:plc:alice/app.bsky.feed.post/key', likeCount: 0 }] }) : ok(url));
  const result = await getPublisher('bluesky').fetchMetrics!(credentials.bluesky, 'at://did:plc:alice/app.bsky.feed.post/key');
  assert.equal(result.likes, 0);
  assert.notEqual(result.likes, null);
  assert.equal(result.replies, null);
  assert.equal(result.reposts, null);
  assert.equal(result.quotes, null);
  assert.equal(result.impressions, null);
});
test('Telegram has no fetchMetrics and resolves to the unsupported outcome', async () => {
  const adapter = getPublisher('telegram');
  assert.equal(adapter.fetchMetrics, undefined);
  const result = await fetchTargetMetrics(adapter, credentials.telegram, '42');
  assert.deepEqual(result, { outcome: 'unsupported', metrics: null });
});
/** Records inserts; throws on any update/delete so a test fails if the tick ever writes post/target status. */
function fakeMetricsDb(candidates: unknown[], latestRows: unknown[], channelRows: Record<string, unknown>[]) {
  const writes: { table: unknown; rows: unknown[] }[] = [];
  const queue: unknown[] = [candidates, latestRows, ...channelRows.map(row => [row])];
  const chain = (result: unknown) => {
    const self: Record<string, unknown> = { then: (resolve?: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(result).then(resolve, reject) };
    for (const method of ['from', 'innerJoin', 'where', 'orderBy', 'limit', 'groupBy']) self[method] = () => self;
    return self;
  };
  return {
    writes,
    select: () => chain(queue.shift() ?? []),
    insert: (table: unknown) => ({
      values: (rows: unknown) => { writes.push({ table, rows: Array.isArray(rows) ? rows : [rows] }); return chain([]); },
    }),
    update: () => { throw new Error('refreshMetricsTick must not update any table'); },
    delete: () => { throw new Error('refreshMetricsTick must not delete any table'); },
  };
}
test('metrics: auth failure yields auth_expired and the tick never writes post/target status', async () => {
  process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
  const now = new Date();
  const targetId = crypto.randomUUID();
  const candidates = [{ targetId, remoteId: '8', publishedAt: new Date(now.getTime() - 3_600_000), provider: 'mastodon', credentialsEnc: encryptCredentials({ instanceUrl: 'https://mastodon.example', accessToken: 'test-secret' }) }];
  const db = fakeMetricsDb(candidates, [], []);
  const calls = mock(() => response({ error: 'The access token is invalid' }, 401));
  const refreshed = await refreshMetricsTick(db as never);
  assert.equal(refreshed, 1);
  // Anonymous read refused, then the token is refused too.
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map(c => c.url), ['https://mastodon.example/api/v1/statuses/8', 'https://mastodon.example/api/v1/statuses/8']);
  assert.equal(db.writes.length, 1);
  assert.equal(db.writes[0].table, postMetrics);
  const row = db.writes[0].rows[0] as Record<string, unknown>;
  assert.equal(row.targetId, targetId);
  assert.equal(row.outcome, 'auth_expired');
  for (const key of ['likes', 'replies', 'reposts', 'quotes', 'impressions']) assert.equal(row[key], null);
});
test('metrics refresh: a target inside its backoff interval is not refetched', async () => {
  const now = new Date();
  const targetId = crypto.randomUUID();
  const candidates = [{ targetId, remoteId: '8', publishedAt: new Date(now.getTime() - 3_600_000), provider: 'mastodon', credentialsEnc: 'unused' }];
  const fresh = fakeMetricsDb(candidates, [{ targetId, fetchedAt: new Date(now.getTime() - 10 * 60_000) }], []);
  const calls = mock(url => ok(url));
  assert.equal(await refreshMetricsTick(fresh as never), 0);
  assert.equal(fresh.writes.length, 0);
  assert.equal(calls.length, 0);
});
test('metrics refresh: backoff grows with post age', () => {
  const now = new Date();
  assert.equal(metricsRefreshIntervalMs(new Date(now.getTime() - 3_600_000), now), 3_600_000);
  assert.equal(metricsRefreshIntervalMs(new Date(now.getTime() - 2 * 86_400_000), now), 6 * 3_600_000);
  assert.equal(metricsRefreshIntervalMs(new Date(now.getTime() - 20 * 86_400_000), now), 24 * 3_600_000);
});
test('AN-3: populated previous period returns a real delta', () => {
  const now = new Date('2026-09-16T12:00:00Z');
  const day = 86_400_000;
  const values = (likes: number, replies: number, reposts: number) => ({ likes, replies, reposts, quotes: null, impressions: null });
  const points = [
    { fetchedAt: new Date(now.getTime() - 9 * day), values: values(10, 1, 0) },
    { fetchedAt: new Date(now.getTime() - 8 * day), values: values(14, 1, 0) },
    { fetchedAt: new Date(now.getTime() - 2 * day), values: values(30, 5, 2) },
    { fetchedAt: new Date(now.getTime() - 1 * day), values: values(40, 7, 2) },
  ];
  const result = compareMetricHistory(points, now);
  assert.equal(result.state, 'compared');
  assert.deepEqual(result.deltas, [{ key: 'likes', delta: 26 }, { key: 'replies', delta: 6 }, { key: 'reposts', delta: 2 }]);
});
test('AN-3: empty previous period is an explicit no-previous state, never a fabricated 0 %', () => {
  const now = new Date('2026-09-16T12:00:00Z');
  const day = 86_400_000;
  const points = [
    { fetchedAt: new Date(now.getTime() - 2 * day), values: { likes: 5, replies: 0, reposts: 0, quotes: null, impressions: null } },
    { fetchedAt: new Date(now.getTime() - 1 * day), values: { likes: 9, replies: 1, reposts: 0, quotes: null, impressions: null } },
  ];
  const result = compareMetricHistory(points, now);
  assert.equal(result.state, 'no_previous');
  assert.equal(result.deltas.length, 0);
  assert.deepEqual(compareMetricHistory([], now), { state: 'no_data', currentWindow: null, previousWindow: null, deltas: [] });
});
