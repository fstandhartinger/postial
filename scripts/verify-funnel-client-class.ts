import assert from 'node:assert/strict';
import test from 'node:test';
import { and, eq, inArray } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
// Must run before any next/dist module loads: they need the global AsyncLocalStorage.
import './test-runtime';
import { NextRequest } from 'next/server';
import { createRequestStoreForAPI } from 'next/dist/server/async-storage/request-store';
import { workUnitAsyncStorage } from 'next/dist/server/app-render/work-unit-async-storage.external';
import { workAsyncStorage, type WorkStore } from 'next/dist/server/app-render/work-async-storage.external';
import { getDb } from '../db';
import { apiKeys, brands, channels, funnelEvents, oauthStates, posts, postTargets, sessions, subscriptions, users, workspaceMembers, workspaces } from '../db/schema';
import { GET as excludeMe } from '../app/api/internal/exclude-me/route';
import { POST as clientReady } from '../app/api/internal/client-ready/route';
import { classifyRequest, classifyUserAgent, CLIENT_CLASSES, funnelReport, internalMarkerValue, recordFunnelEvent, requestClientClass, searchEngine } from '../lib/funnel';
import { ensureWorkspace } from '../lib/workspaces';
import { createPost } from '../lib/api/posts';
import type { ApiContext } from '../lib/api/auth';
import { finishAuth } from '../lib/publishers/oauth';
import { encryptCredentials } from '../lib/crypto';
import { tick } from '../lib/publishing';
import { getPublisher, registerPublisher } from '../lib/publishers';
import { installBillingMock } from './billing-mock';
import { deleteFixtureUsers } from './fixture-cleanup';

const db = getDb();

// Runs a piece of the real product inside a Next.js request context built from the given
// headers, so `headers()`/`cookies()` resolve exactly as they would for a real request.
// This is the same pattern scripts/billing-mock.ts uses for route handlers.
function requestScope(headers: Record<string, string>, run: () => Promise<unknown>): Promise<unknown> {
  const url = new URL('http://127.0.0.1/verify-funnel-class');
  const request = new NextRequest(url, { headers });
  const store = createRequestStoreForAPI(request, { pathname: url.pathname, search: url.search }, { tags: [], expirationsByCacheKind: new Map() }, undefined, undefined, undefined);
  const workStore = { route: url.pathname, page: url.pathname, isStaticGeneration: false } as WorkStore;
  return workAsyncStorage.run(workStore, () => workUnitAsyncStorage.run(store, () => run()));
}

const browserUserAgent = 'Mozilla/5.0 AppleWebKit/537.36 Chrome/140 Safari/537.36';
const browserScopeHeaders: Record<string, string> = { 'user-agent': browserUserAgent };
const internalScopeHeaders = (marker: string): Record<string, string> => ({ 'user-agent': browserUserAgent, cookie: `pm_internal=${marker}` });

/** Activates a fixture internal marker and returns its restore. */
function internalToken(): { marker: string; restore: () => void } {
  const previous = process.env.FUNNEL_INTERNAL_TOKEN;
  process.env.FUNNEL_INTERNAL_TOKEN = `verify-${crypto.randomUUID()}`;
  const marker = internalMarkerValue();
  assert.ok(marker);
  return { marker, restore: () => { if (previous === undefined) delete process.env.FUNNEL_INTERNAL_TOKEN; else process.env.FUNNEL_INTERNAL_TOKEN = previous; } };
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}
async function close(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
}

/** Class breakdown of one event scoped to workspaces; each workspace must appear at most once. */
async function classesFor(event: string, workspaceIds: string[]): Promise<Map<string, string>> {
  const rows = await db.select({ workspaceId: funnelEvents.workspaceId, clientClass: funnelEvents.clientClass })
    .from(funnelEvents).where(and(eq(funnelEvents.event, event), inArray(funnelEvents.workspaceId, workspaceIds)));
  return new Map(rows.map(row => [row.workspaceId as string, row.clientClass]));
}

async function funnelFixtureUser(name: string) {
  const userId = crypto.randomUUID();
  await db.insert(users).values({ id: userId, name });
  return userId;
}

test('classifies browser and common automated user agents without retaining the header', async () => {
  for (const userAgent of [
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18 Safari/605.1.15',
  ]) assert.equal(classifyUserAgent(userAgent), 'browser');
  for (const userAgent of ['Googlebot/2.1', 'ExampleCrawler/1.0', 'HEADLESS-Chrome', 'curl/8.0', 'python-requests/2.32', 'Lighthouse']) {
    assert.equal(classifyUserAgent(userAgent), 'automated');
  }
  assert.equal(classifyUserAgent(undefined), 'automated');
  assert.equal(classifyUserAgent(null), 'automated');

  const marker = `ua-never-store-${crypto.randomUUID()}`;
  const event = `landing_view`;
  await recordFunnelEvent(event, { path: '/verify-client-class', clientClass: classifyUserAgent(marker) });
  const rows = await db.select().from(funnelEvents).where(eq(funnelEvents.path, '/verify-client-class'));
  assert.ok(rows.length > 0);
  assert.ok(rows.every(row => row.clientClass === 'browser'));
  assert.equal(JSON.stringify(rows).includes(marker), false);
  // Assert the property, not the phrasing. This used to match the exact call
  // classifyUserAgent(h.get('user-agent')), so introducing a local variable broke it while
  // the behaviour was unchanged. What matters is that the header is read, classified, and
  // never handed to the recorder as a value.
  const funnelSource = readFileSync('lib/funnel.ts', 'utf8');
  assert.match(funnelSource, /classifyUserAgent\(/, 'the public view classifies the agent');
  assert.match(funnelSource, /h\.get\('user-agent'\)/, 'and reads it from the request header');
  assert.doesNotMatch(funnelSource, /props:\s*\{[^}]*userAgent/i, 'the raw agent never reaches props');
});

test('classifyRequest separates browser, automated and configured internal requests', () => {
  const previousToken = process.env.FUNNEL_INTERNAL_TOKEN;
  const token = `verify-${crypto.randomUUID()}`;
  const browserUserAgent = 'Mozilla/5.0 AppleWebKit/537.36 Chrome/140 Safari/537.36';
  try {
    process.env.FUNNEL_INTERNAL_TOKEN = token;
    const marker = internalMarkerValue();
    assert.ok(marker);
    assert.match(marker, /^[a-f0-9]{64}$/);

    assert.deepEqual([...CLIENT_CLASSES], ['browser', 'automated', 'internal', 'unknown', 'system']);
    const headers = (values: Record<string, string>) => new Headers({ 'user-agent': browserUserAgent, ...values });
    assert.equal(classifyRequest(headers({})), 'browser');
    assert.equal(classifyRequest(new Headers({ 'user-agent': 'curl/8.0' })), 'automated');
    assert.equal(classifyRequest(headers({ 'x-postial-internal': token })), 'internal');
    assert.equal(classifyRequest(headers({ cookie: `pm_internal=${marker}` })), 'internal');
    assert.equal(classifyRequest(headers({ 'x-postial-internal': `${token}x` })), 'browser');
    assert.equal(classifyRequest(headers({ cookie: `pm_internal=${marker}x` })), 'browser');

    delete process.env.FUNNEL_INTERNAL_TOKEN;
    assert.equal(classifyRequest(headers({ 'x-postial-internal': token, cookie: `pm_internal=${marker}` })), 'browser');
    process.env.FUNNEL_INTERNAL_TOKEN = 'short';
    assert.equal(classifyRequest(headers({ 'x-postial-internal': 'short', cookie: 'pm_internal=ignored' })), 'browser');
  } finally {
    if (previousToken === undefined) delete process.env.FUNNEL_INTERNAL_TOKEN;
    else process.env.FUNNEL_INTERNAL_TOKEN = previousToken;
  }
});

test('requestClientClass follows the request and falls back to system outside one', async () => {
  const { marker, restore } = internalToken();
  try {
    // No request context at all: background callers get the explicit system class.
    assert.equal(await requestClientClass(), 'system');
    assert.equal(await requestScope(browserScopeHeaders, () => requestClientClass()), 'browser');
    assert.equal(await requestScope({ 'user-agent': 'curl/8.0' }, () => requestClientClass()), 'automated');
    assert.equal(await requestScope({ 'user-agent': browserUserAgent, 'x-postial-internal': process.env.FUNNEL_INTERNAL_TOKEN! }, () => requestClientClass()), 'internal');
    assert.equal(await requestScope(internalScopeHeaders(marker), () => requestClientClass()), 'internal');
  } finally { restore(); }
});

/** Extracts the options object of every recordFunnelEvent('<event>', ...) call in a file. */
function eventOptions(source: string, event: string): string[] {
  const results: string[] = [];
  for (const match of source.matchAll(new RegExp(`recordFunnelEvent\\('${event}',\\s*\\{`, 'g'))) {
    const start = (match.index ?? 0) + match[0].length;
    let depth = 1, index = start;
    for (; index < source.length && depth > 0; index++) {
      const character = source[index];
      if (character === '{' || character === '(') depth++;
      else if (character === '}' || character === ')') depth--;
    }
    results.push(source.slice(start, index - 1));
  }
  return results;
}

test('every account and billing call site passes a client class', () => {
  const followRequest = (file: string, event: string, minimum = 1) => {
    const options = eventOptions(readFileSync(file, 'utf8'), event);
    const following = options.filter(text => /clientClass:\s*await requestClientClass\(\)/.test(text)).length;
    assert.ok(options.length >= minimum && following >= minimum,
      `${file}: '${event}' must pass clientClass: await requestClientClass() (${following}/${options.length} calls)`);
  };
  const recordedAsSystem = (file: string, event: string, minimum = 1) => {
    const options = eventOptions(readFileSync(file, 'utf8'), event);
    const recorded = options.filter(text => /clientClass:\s*'system'/.test(text)).length;
    assert.ok(options.length >= minimum && recorded >= minimum,
      `${file}: '${event}' must pass clientClass: 'system' (${recorded}/${options.length} calls)`);
  };
  followRequest('app/login/page.tsx', 'signup_started', 2);
  followRequest('auth.ts', 'signup_completed');
  followRequest('lib/workspaces.ts', 'workspace_created');
  followRequest('lib/publishers/oauth.ts', 'channel_connected');
  followRequest('app/app/actions.ts', 'channel_connected');
  followRequest('app/app/actions.ts', 'post_scheduled');
  followRequest('lib/api/posts.ts', 'post_scheduled');
  followRequest('lib/api/bulk.ts', 'post_scheduled', 2);
  followRequest('app/api/stripe/checkout/route.ts', 'checkout_started');
  // Background processing has no request context and must say so explicitly.
  recordedAsSystem('lib/publishing/index.ts', 'post_published');
  recordedAsSystem('app/api/stripe/webhook/route.ts', 'subscription_active');
  recordedAsSystem('app/api/stripe/webhook/route.ts', 'trial_started');
  recordedAsSystem('app/api/stripe/webhook/route.ts', 'subscription_paid');
  assert.doesNotMatch(readFileSync('app/api/stripe/webhook/route.ts', 'utf8'), /requestClientClass/);
  assert.doesNotMatch(readFileSync('lib/publishing/index.ts', 'utf8'), /requestClientClass/);
});

test('workspace_created records the class of the creating request', async () => {
  const { marker, restore } = internalToken();
  const internalUser = crypto.randomUUID(), browserUser = crypto.randomUUID();
  let workspaceIds: string[] = [];
  try {
    await db.insert(users).values([
      { id: internalUser, name: 'Funnel class fixture' }, { id: browserUser, name: 'Funnel class fixture' },
    ]);
    await requestScope(internalScopeHeaders(marker), () => ensureWorkspace(internalUser));
    await requestScope(browserScopeHeaders, () => ensureWorkspace(browserUser));
    const created = await db.select({ id: workspaces.id, ownerUserId: workspaces.ownerUserId })
      .from(workspaces).where(inArray(workspaces.ownerUserId, [internalUser, browserUser]));
    workspaceIds = created.map(row => row.id);
    assert.equal(workspaceIds.length, 2);
    const byWorkspace = await classesFor('workspace_created', workspaceIds);
    assert.equal(byWorkspace.get(created.find(row => row.ownerUserId === internalUser)!.id), 'internal', 'a hard-coded class cannot follow the internal marker');
    assert.equal(byWorkspace.get(created.find(row => row.ownerUserId === browserUser)!.id), 'browser', 'a plain browser request must record browser');
  } finally {
    if (workspaceIds.length) await db.delete(funnelEvents).where(inArray(funnelEvents.workspaceId, workspaceIds));
    await deleteFixtureUsers(db).where(inArray(users.id, [internalUser, browserUser]));
    restore();
  }
});

test('channel_connected records the class of the oauth callback request', async () => {
  const endpoint = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    if (req.url?.startsWith('/2/oauth2/token')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ access_token: 'x-access', refresh_token: 'x-refresh', expires_in: 7200 }));
      return;
    }
    if (req.url?.startsWith('/2/users/me')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: { id: 'x-account', username: 'funnel' } }));
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' }).end('{}');
  });
  const endpointUrl = await listen(endpoint);
  const env = process.env as Record<string, string | undefined>;
  const backup = { clientId: env.X_CLIENT_ID, clientSecret: env.X_CLIENT_SECRET, apiBase: env.X_API_BASE_URL };
  const { marker, restore } = internalToken();
  const userId = await funnelFixtureUser('OAuth funnel fixture');
  let workspaceId = '', brandId = '';
  try {
    env.X_CLIENT_ID = 'funnel-fixture-x';
    env.X_CLIENT_SECRET = 'funnel-fixture-x-secret';
    env.X_API_BASE_URL = endpointUrl;
    const [workspace] = await db.insert(workspaces).values({ name: 'OAuth funnel fixture', slug: `fixture-${userId}`, ownerUserId: userId }).returning();
    workspaceId = workspace.id;
    await db.insert(workspaceMembers).values({ workspaceId, userId, role: 'owner' });
    const [brand] = await db.insert(brands).values({ workspaceId, name: 'OAuth funnel', slug: `oauth-${userId.slice(0, 8)}` }).returning();
    brandId = brand.id;
    const internalState = randomBytes(32).toString('base64url'), browserState = randomBytes(32).toString('base64url');
    assert.match(internalState, /^[A-Za-z0-9_-]{43}$/);
    assert.match(browserState, /^[A-Za-z0-9_-]{43}$/);
    await db.insert(oauthStates).values([
      { state: internalState, codeVerifier: encryptCredentials({ verifier: randomBytes(32).toString('base64url') }), brandId, userId, provider: 'x', expiresAt: new Date(Date.now() + 600000) },
      { state: browserState, codeVerifier: encryptCredentials({ verifier: randomBytes(32).toString('base64url') }), brandId, userId, provider: 'x', expiresAt: new Date(Date.now() + 600000) },
    ]);
    await requestScope(internalScopeHeaders(marker), () => finishAuth('x', internalState, 'fixture-code', userId));
    await requestScope(browserScopeHeaders, () => finishAuth('x', browserState, 'fixture-code', userId));
    const rows = await db.select({ clientClass: funnelEvents.clientClass }).from(funnelEvents)
      .where(and(eq(funnelEvents.event, 'channel_connected'), eq(funnelEvents.workspaceId, workspaceId)));
    assert.deepEqual(rows.map(row => row.clientClass).sort(), ['browser', 'internal'],
      'the recorded class must follow the callback request; a hard-coded constant fails here');
  } finally {
    if (brandId) await db.delete(funnelEvents).where(and(eq(funnelEvents.event, 'channel_connected'), eq(funnelEvents.workspaceId, workspaceId)));
    await deleteFixtureUsers(db).where(eq(users.id, userId));
    for (const [key, value] of Object.entries(backup)) {
      if (value === undefined) delete env[key];
      else env[key] = value;
    }
    restore();
    await close(endpoint);
  }
});

test('post_scheduled records the class of the API request', async () => {
  const { marker, restore } = internalToken();
  const userId = await funnelFixtureUser('Post funnel fixture');
  let workspaceId = '';
  try {
    const [workspace] = await db.insert(workspaces).values({ name: 'Post funnel fixture', slug: `fixture-${userId}`, ownerUserId: userId }).returning();
    workspaceId = workspace.id;
    await db.insert(subscriptions).values({ workspaceId, status: 'active', currentPeriodEnd: new Date(Date.now() + 7 * 86400000), stripeSubscriptionId: `fixture-${userId}` });
    const [first] = await db.insert(brands).values({ workspaceId, name: 'First', slug: `first-${userId.slice(0, 8)}` }).returning();
    const [second] = await db.insert(brands).values({ workspaceId, name: 'Second', slug: `second-${userId.slice(0, 8)}` }).returning();
    for (const brand of [first, second]) await db.insert(channels).values({
      brandId: brand.id, provider: 'telegram', displayName: 'Fixture channel', externalId: 'fixture-channel',
      credentialsEnc: encryptCredentials({ token: 'fixture-token' }), status: 'active', lastCheckedAt: new Date(),
    }).returning();
    const channelIds = await db.select({ id: channels.id, brandId: channels.brandId }).from(channels).where(inArray(channels.brandId, [first.id, second.id]));
    const [key] = await db.insert(apiKeys).values({
      workspaceId, createdByUserId: userId, name: 'Fixture key', keyPrefix: 'funnel', keyHash: `hash-${userId}`, scopes: ['posts:write'],
    }).returning();
    const ctx = { key, workspace, db, userId } as ApiContext;
    const channelFor = (brandId: string) => channelIds.find(row => row.brandId === brandId)!.id;
    const call = (brandId: string) => new Request('http://127.0.0.1/api/v1/posts', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ brand_id: brandId, body: 'Fixture scheduled funnel post', channel_ids: [channelFor(brandId)], scheduled_at: new Date(Date.now() + 3600000).toISOString() }),
    });
    await requestScope(internalScopeHeaders(marker), () => createPost(call(first.id), ctx));
    await requestScope(browserScopeHeaders, () => createPost(call(second.id), ctx));
    const rows = await db.select({ clientClass: funnelEvents.clientClass }).from(funnelEvents)
      .where(and(eq(funnelEvents.event, 'post_scheduled'), eq(funnelEvents.workspaceId, workspaceId)));
    assert.deepEqual(rows.map(row => row.clientClass).sort(), ['browser', 'internal'],
      'the recorded class must follow the API request; a hard-coded constant fails here');
  } finally {
    if (workspaceId) await db.delete(funnelEvents).where(and(eq(funnelEvents.event, 'post_scheduled'), eq(funnelEvents.workspaceId, workspaceId)));
    await deleteFixtureUsers(db).where(eq(users.id, userId));
    restore();
  }
});

test('checkout_started records the class of the checkout request', async () => {
  const restoreFetch = await installBillingMock();
  const { marker, restore } = internalToken();
  const internalUser = await funnelFixtureUser('Checkout funnel fixture'), browserUser = await funnelFixtureUser('Checkout funnel fixture 2');
  let workspaceIds: string[] = [];
  try {
    await db.insert(sessions).values([
      { userId: internalUser, sessionToken: `session-${internalUser}`, expires: new Date(Date.now() + 600000) },
      { userId: browserUser, sessionToken: `session-${browserUser}`, expires: new Date(Date.now() + 600000) },
    ]);
    const checkout = (token: string, extraCookie?: string) => fetch('http://localhost:3992/api/stripe/checkout', {
      method: 'POST', headers: {
        origin: 'http://localhost:3992', 'content-type': 'application/json', 'user-agent': browserUserAgent,
        cookie: extraCookie ? `authjs.session-token=${token}; ${extraCookie}` : `authjs.session-token=${token}`,
      }, body: JSON.stringify({ plan: 'agency' }),
    });
    const internalResponse = await checkout(`session-${internalUser}`, `pm_internal=${marker}`);
    assert.equal(internalResponse.status, 200, `checkout with the internal marker must succeed: ${await internalResponse.text()}`);
    const browserResponse = await checkout(`session-${browserUser}`);
    assert.equal(browserResponse.status, 200, `plain browser checkout must succeed: ${await browserResponse.text()}`);
    const created = await db.select({ id: workspaces.id, ownerUserId: workspaces.ownerUserId })
      .from(workspaces).where(inArray(workspaces.ownerUserId, [internalUser, browserUser]));
    workspaceIds = created.map(row => row.id);
    assert.equal(workspaceIds.length, 2);
    const byWorkspace = await classesFor('checkout_started', workspaceIds);
    assert.equal(byWorkspace.get(created.find(row => row.ownerUserId === internalUser)!.id), 'internal', 'a hard-coded class cannot follow the internal marker');
    assert.equal(byWorkspace.get(created.find(row => row.ownerUserId === browserUser)!.id), 'browser');
  } finally {
    if (workspaceIds.length) await db.delete(funnelEvents).where(inArray(funnelEvents.workspaceId, workspaceIds));
    await deleteFixtureUsers(db).where(inArray(users.id, [internalUser, browserUser]));
    restore();
    restoreFetch();
  }
});

test('post_published is recorded as system background processing', async () => {
  const userId = await funnelFixtureUser('Publishing funnel fixture');
  let workspaceId = '', brandId = '';
  const original = getPublisher('x');
  try {
    const [workspace] = await db.insert(workspaces).values({ name: 'Publishing funnel fixture', slug: `fixture-${userId}`, ownerUserId: userId }).returning();
    workspaceId = workspace.id;
    await db.insert(subscriptions).values({ workspaceId, status: 'active', currentPeriodEnd: new Date(Date.now() + 7 * 86400000), stripeSubscriptionId: `fixture-${userId}` });
    const [brand] = await db.insert(brands).values({ workspaceId, name: 'Publishing funnel', slug: `publish-${userId.slice(0, 8)}` }).returning();
    brandId = brand.id;
    const [channel] = await db.insert(channels).values({
      brandId, provider: 'x', displayName: 'Fixture channel', externalId: 'x-account',
      credentialsEnc: encryptCredentials({ accessToken: 'x-access', expiresAt: String(Date.now() + 7200000) }), status: 'active', lastCheckedAt: new Date(),
    }).returning();
    // The registry fake keeps publishing local; the metrics override keeps the whole tick free
    // of provider network calls.
    registerPublisher({ ...original, publish: async () => ({ remoteId: `funnel-${crypto.randomUUID()}` }), fetchMetrics: undefined });
    const [post] = await db.insert(posts).values({ brandId, authorUserId: userId, body: 'Funnel published fixture', status: 'scheduled', scheduledAt: new Date(Date.now() - 1000) }).returning();
    await db.insert(postTargets).values({ postId: post.id, channelId: channel.id, status: 'queued', nextAttemptAt: new Date(Date.now() - 1000) });
    await tick();
    const rows = await db.select({ clientClass: funnelEvents.clientClass }).from(funnelEvents)
      .where(and(eq(funnelEvents.event, 'post_published'), eq(funnelEvents.workspaceId, workspaceId)));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].clientClass, 'system', 'the worker publishes without a request and must record system');
  } finally {
    registerPublisher(original);
    if (brandId) await db.delete(funnelEvents).where(and(eq(funnelEvents.event, 'post_published'), eq(funnelEvents.workspaceId, workspaceId)));
    await deleteFixtureUsers(db).where(eq(users.id, userId));
  }
});

test('exclude-me authenticates internally and the client beacon records an internal landing view', async () => {
  const previousToken = process.env.FUNNEL_INTERNAL_TOKEN;
  const token = `verify-${crypto.randomUUID()}`;
  const browserUserAgent = 'Mozilla/5.0 AppleWebKit/537.36 Chrome/140 Safari/537.36';
  const refererHost = `internal-${crypto.randomUUID()}.invalid`;
  try {
    process.env.FUNNEL_INTERNAL_TOKEN = token;
    const marker = internalMarkerValue();
    assert.ok(marker);

    const wrong = await excludeMe(new Request(`http://localhost/api/internal/exclude-me?token=${encodeURIComponent(`${token}x`)}`));
    assert.equal(wrong.status, 404);
    assert.equal(wrong.headers.get('set-cookie'), null);

    const excluded = await excludeMe(new Request(`http://localhost/api/internal/exclude-me?token=${encodeURIComponent(token)}`));
    assert.equal(excluded.status, 200);
    assert.equal(await excluded.text(), 'This browser is now excluded from Postial visitor statistics.');
    const setCookie = excluded.headers.get('set-cookie') ?? '';
    assert.match(setCookie, new RegExp(`^pm_internal=${marker}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax$`));

    const included = await excludeMe(new Request('http://localhost/api/internal/exclude-me?off=1'));
    assert.equal(included.status, 200);
    assert.match(included.headers.get('set-cookie') ?? '', /^pm_internal=; Path=\/; Max-Age=0; HttpOnly; Secure; SameSite=Lax$/);

    const beacon = await clientReady(new Request('http://localhost/api/internal/client-ready', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': browserUserAgent,
        cookie: `pm_internal=${marker}`,
        referer: `https://${refererHost}/`,
      },
      body: JSON.stringify({ path: '/' }),
    }));
    assert.equal(beacon.status, 204);

    let rows = await db.select({ event: funnelEvents.event, clientClass: funnelEvents.clientClass, path: funnelEvents.path })
      .from(funnelEvents).where(and(eq(funnelEvents.referrerHost, refererHost), eq(funnelEvents.path, '/')));
    for (let attempt = 0; attempt < 20 && rows.length === 0; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 25));
      rows = await db.select({ event: funnelEvents.event, clientClass: funnelEvents.clientClass, path: funnelEvents.path })
        .from(funnelEvents).where(and(eq(funnelEvents.referrerHost, refererHost), eq(funnelEvents.path, '/')));
    }
    assert.ok(rows.some(row => row.event === 'landing_view' && row.clientClass === 'internal' && row.path === '/'));
  } finally {
    await db.delete(funnelEvents).where(and(eq(funnelEvents.referrerHost, refererHost), eq(funnelEvents.path, '/')));
    if (previousToken === undefined) delete process.env.FUNNEL_INTERNAL_TOKEN;
    else process.env.FUNNEL_INTERNAL_TOKEN = previousToken;
  }
});

test('privacy policy documents aggregate statistics without behavioral analytics', () => {
  const privacy = JSON.parse(readFileSync('content/privacy.json', 'utf8')) as string;
  assert.match(privacy, /## Aggregate website and product statistics/);
  assert.match(privacy, /Events are deleted after 180 days/);
  assert.doesNotMatch(privacy, /behavioral analytics/);
});

test('admin funnel report keeps all four client classes separate', async () => {
  const path = `/verify-client-class-${crypto.randomUUID()}`;
  await recordFunnelEvent('landing_view', { path, clientClass: 'browser' });
  await recordFunnelEvent('landing_view', { path, clientClass: 'automated' });
  await recordFunnelEvent('landing_view', { path, clientClass: 'internal' });
  await recordFunnelEvent('landing_view', { path, clientClass: 'unknown' });
  const report = await funnelReport(30);
  assert.ok((report.clientClassTotals.browser.landing_view ?? 0) >= 1);
  assert.ok((report.clientClassTotals.automated.landing_view ?? 0) >= 1);
  assert.ok((report.clientClassTotals.internal.landing_view ?? 0) >= 1);
  assert.ok((report.clientClassTotals.unknown.landing_view ?? 0) >= 1);
  assert.notEqual(report.clientClassTotals.browser, report.clientClassTotals.automated);
  const admin = readFileSync('app/app/admin/funnel/page.tsx', 'utf8');
  assert.match(admin, /People \(browser\)/);
  assert.match(admin, /Internal \(staff and agents, excluded\)/);
  assert.match(admin, /CLIENT_CLASSES\.map\(clientClass/);
  assert.match(admin, /report\.clientClassTotals\[clientClass\]/);
});

test.after(async () => { await db.$client.end(); });

// Which search engine crawls us, if any. Search is the only acquisition channel we direct
// ourselves, and until now nothing recorded whether it was being crawled at all. Only the
// engine family is stored, never the user agent, and only for programs that announce
// themselves as crawlers; a real browser records nothing.
{
  const cases: ReadonlyArray<readonly [string, string | undefined]> = [
    ['Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', 'google'],
    ['Mozilla/5.0 (compatible; bingbot/2.0)', 'bing'],
    ['DuckDuckBot/1.1', 'duckduckgo'],
    ['GPTBot/1.2', 'ai'],
    ['Mozilla/5.0 AppleWebKit (KHTML, like Gecko) Chrome/120 Safari/537', undefined],
    ['curl/8.5.0', undefined],
    ['', undefined],
  ];
  for (const [agent, expected] of cases) {
    assert.equal(searchEngine(agent), expected, `search engine for ${agent.slice(0, 30) || '(none)'}`);
    if (expected) assert.equal(classifyUserAgent(agent), 'automated', 'a crawler stays machine-shaped');
  }
  console.log('PASS funnel: the crawling search engine is recorded by family, never by agent');
}
