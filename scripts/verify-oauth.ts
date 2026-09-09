// Local HTTP + real PostgreSQL. All X/Meta endpoints are replaced by a loopback server.
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import { getDb } from '../db';
import { brands, channels, oauthStates, posts, postTargets, subscriptions, sessions, users, workspaceMembers, workspaces } from '../db/schema';
import { decryptCredentials, encryptCredentials } from '../lib/crypto';
import { tick } from '../lib/publishing';
import { oauthEndpoint } from '../lib/publishers/oauth-config';
import { availableProviders, getPublisher, registerPublisher } from '../lib/publishers';
async function listen(server: Server) { await new Promise<void>(r => server.listen(0, '127.0.0.1', r)); return `http://127.0.0.1:${(server.address() as { port: number }).port}`; }
async function close(server: Server) { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); }
async function main() {
  assert.notEqual(process.env.NODE_ENV, 'production');
  process.env.AUTH_SECRET = randomBytes(32).toString('hex');
  process.env.APP_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  process.env.X_CLIENT_ID = 'local-x'; process.env.X_CLIENT_SECRET = 'local-x-secret';
  process.env.THREADS_APP_ID = 'local-threads'; process.env.THREADS_APP_SECRET = 'local-threads-secret';
  const db = getDb(), userId = crypto.randomUUID(), foreignId = crypto.randomUUID(), sessionToken = randomBytes(32).toString('hex');
  let tokenFailure = false;
  const requests: { path: string; body: URLSearchParams }[] = [];
  const endpoint = createServer(async (req, res) => {
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const url = new URL(req.url!, 'http://127.0.0.1'), body = new URLSearchParams(Buffer.concat(chunks).toString());
    requests.push({ path: url.pathname, body });
    if (tokenFailure) { res.writeHead(503, {'Content-Type':'application/json'}).end('{}'); return; }
    const responses: Record<string, unknown> = {
      '/2/oauth2/token': { access_token: 'x-access', refresh_token: 'x-refresh', expires_in: 7200 },
      '/2/users/me': { data: { id: 'x-account', username: 'test' } },
      '/oauth/access_token': { access_token: 'threads-short' },
      '/access_token': { access_token: 'threads-long', expires_in: 5184000 },
      '/v1.0/me': { id: 'threads-account', username: 'test' },
    };
    res.writeHead(responses[url.pathname] ? 200 : 404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(responses[url.pathname] ?? {}));
  });
  const endpointUrl = await listen(endpoint);
  process.env.X_API_BASE_URL = endpointUrl; process.env.THREADS_API_BASE_URL = endpointUrl;
  const { POST } = await import('../app/api/oauth/[provider]/start/route');
  const { GET } = await import('../app/api/oauth/[provider]/callback/route');
  let appUrl = '';
  const server = createServer(async (req, res) => {
    try {
      const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const request = new NextRequest(appUrl + req.url, { method: req.method, headers: req.headers as Record<string, string>, ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) });
      const handler = req.method === 'POST' ? POST : GET;
      const response = await handler(request, { params: Promise.resolve({ provider: req.url!.split('/')[3] }) });
      assert(response);
      res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(await response.text());
    } catch { res.writeHead(500).end('Harness failed'); }
  });
  let workspaceId: string | undefined;
  try {
    appUrl = await listen(server); process.env.APP_URL = appUrl; process.env.AUTH_URL = appUrl;
    await db.insert(users).values([{ id: userId, email: `${userId}@example.invalid` }, { id: foreignId, email: `${foreignId}@example.invalid` }]);
    const [workspace] = await db.insert(workspaces).values({ name: 'OAuth verification', slug: userId, ownerUserId: userId }).returning(); workspaceId = workspace.id;
    await db.insert(workspaceMembers).values({ workspaceId, userId, role: 'owner' });
    const [brand] = await db.insert(brands).values({ workspaceId, name: 'OAuth', slug: 'oauth' }).returning();
    await db.insert(sessions).values({ sessionToken, userId, expires: new Date(Date.now() + 3600000) });
    const foreignToken = randomBytes(32).toString('hex');
    await db.insert(sessions).values({ sessionToken: foreignToken, userId: foreignId, expires: new Date(Date.now() + 3600000) });
    const headers = { cookie: `authjs.session-token=${sessionToken}`, origin: appUrl };
    const start = (provider: string, withHeaders = headers) => fetch(`${appUrl}/api/oauth/${provider}/start`, { method: 'POST', headers: withHeaders, body: new URLSearchParams({ brandId: brand.id }), redirect: 'manual' });
    const callback = (provider: string, state: string, cookie = headers.cookie) => fetch(`${appUrl}/api/oauth/${provider}/callback?state=${state}&code=mock-code`, { headers: { cookie }, redirect: 'manual' });
    assert.equal((await start('x', { cookie: '', origin: appUrl })).status, 401);
    assert.equal((await start('x', { ...headers, origin: 'https://foreign.invalid' })).status, 403);
    assert.equal((await start('unknown')).status, 404);
    assert.equal((await start('x', { ...headers, cookie: `authjs.session-token=${foreignToken}` })).status, 400);
    for (const provider of ['x', 'threads']) {
      const started = await start(provider); assert.equal(started.status, 303);
      const url = new URL(started.headers.get('location')!), state = url.searchParams.get('state')!;
      assert.equal(url.searchParams.get('redirect_uri'), `${appUrl}/api/oauth/${provider}/callback`);
      const [saved] = await db.select().from(oauthStates).where(eq(oauthStates.state, state));
      assert.equal(saved.userId, userId); assert.equal(saved.brandId, brand.id);
      assert(saved.expiresAt.getTime() <= Date.now() + 600000);
      if (provider === 'x') {
        assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
        assert.equal(url.searchParams.get('code_challenge'), createHash('sha256').update(decryptCredentials(saved.codeVerifier).verifier).digest('base64url'));
      }
      assert.match((await callback(provider, state, '')).headers.get('location')!, /connect_error=expired$/);
      assert.match((await callback(provider, state, `authjs.session-token=${foreignToken}`)).headers.get('location')!, /connect_error=expired$/);
      assert.match((await callback(provider === 'x' ? 'threads' : 'x', state)).headers.get('location')!, /connect_error=expired$/);
      const completed = await callback(provider, state); assert.equal(completed.status, 303);
      assert(completed.headers.get('location')?.includes(`/app/brands/${brand.id}`));
      const [channel] = await db.select().from(channels).where(and(eq(channels.brandId, brand.id), eq(channels.provider, provider as 'x' | 'threads')));
      assert.equal(channel.status, 'active'); assert(!channel.credentialsEnc.includes('access'));
      const credentials = decryptCredentials(channel.credentialsEnc); assert(Number(credentials.expiresAt) > Date.now());
      assert.equal(credentials.accessToken, provider === 'x' ? 'x-access' : 'threads-long');
      const before = requests.length; assert.match((await callback(provider, state)).headers.get('location')!, /connect_error=expired$/); assert.equal(requests.length, before);
      const restarted = new URL((await start(provider)).headers.get('location')!);
      const race = await Promise.all([callback(provider, restarted.searchParams.get('state')!), callback(provider, restarted.searchParams.get('state')!)]);
      assert(race.every(r => r.status === 303)); assert.equal(race.filter(r => r.headers.get('location')?.includes('connect_error=expired')).length, 1);
      assert.equal((await db.select().from(channels).where(and(eq(channels.brandId, brand.id), eq(channels.provider, provider as 'x' | 'threads')))).length, 1);
      const expired = new URL((await start(provider)).headers.get('location')!).searchParams.get('state')!;
      await db.update(oauthStates).set({ expiresAt: new Date(0) }).where(eq(oauthStates.state, expired));
      assert.match((await callback(provider, expired)).headers.get('location')!, /connect_error=expired$/);
    }
    assert.equal(requests.find(r => r.path === '/2/oauth2/token')?.body.get('grant_type'), 'authorization_code');
    assert.equal(requests.find(r => r.path === '/oauth/access_token')?.body.get('client_id'), 'local-threads');
    // Worker integration: two targets sharing one channel must rotate only once.
    // Editors can connect, with safe brand-bound browser error navigation.
    await db.update(workspaceMembers).set({role:'editor'}).where(eq(workspaceMembers.userId,userId));
    const deniedState = new URL((await start('x')).headers.get('location')!).searchParams.get('state')!;
    const denied = await fetch(`${appUrl}/api/oauth/x/callback?state=${deniedState}&error=access_denied`, {headers,redirect:'manual'});
    assert.equal(denied.status,303); assert.equal(denied.headers.get('location'), `${appUrl}/app/brands/${brand.id}?connect_error=denied`);
    const failedState = new URL((await start('x')).headers.get('location')!).searchParams.get('state')!;
    tokenFailure = true;
    const failed = await callback('x',failedState); tokenFailure = false;
    assert.equal(failed.status,303); assert.equal(failed.headers.get('location'), `${appUrl}/app/brands/${brand.id}?connect_error=provider_error`);
    await db.update(workspaceMembers).set({role:'owner'}).where(eq(workspaceMembers.userId,userId));
    await db.insert(subscriptions).values({ workspaceId: workspace.id, status: 'active', currentPeriodEnd: new Date(Date.now() + 86400000), stripeSubscriptionId: `fixture-${userId}` });
    const [xChannel] = await db.select().from(channels).where(and(eq(channels.brandId, brand.id), eq(channels.provider, 'x')));
    await db.update(channels).set({ credentialsEnc: encryptCredentials({ accessToken: 'old', refreshToken: 'rotate', expiresAt: String(Date.now() + 1000) }) }).where(eq(channels.id, xChannel.id));
    const original = getPublisher('x'); let publishCalls = 0;
    registerPublisher({ ...original, async publish(c) { assert.equal(c.accessToken, 'x-access'); publishCalls++; return { remoteId: `mock-${publishCalls}` }; } });
    const makeTarget = async () => {
      const [p] = await db.insert(posts).values({ brandId: brand.id, authorUserId: userId, body: 'OAuth worker test', status: 'scheduled', scheduledAt: new Date(Date.now() - 1000) }).returning();
      const [target] = await db.insert(postTargets).values({ postId: p.id, channelId: xChannel.id, status: 'queued', nextAttemptAt: new Date(Date.now() - 1000) }).returning(); return target;
    };
    try {
      await makeTarget(); await makeTarget();
      const before = requests.filter(r => r.body.get('grant_type') === 'refresh_token').length;
      await tick(); assert.equal(publishCalls, 2);
      assert.equal(requests.filter(r => r.body.get('grant_type') === 'refresh_token').length - before, 1);
      const [updated] = await db.select().from(channels).where(eq(channels.id, xChannel.id));
      assert.equal(decryptCredentials(updated.credentialsEnc).refreshToken, 'x-refresh');
      await db.update(channels).set({ credentialsEnc: encryptCredentials({ accessToken: 'old', expiresAt: '1' }) }).where(eq(channels.id, xChannel.id));
      const failed = await makeTarget(); await tick();
      const [expiredChannel] = await db.select().from(channels).where(eq(channels.id, xChannel.id));
      assert.equal(expiredChannel.status, 'token_expired'); assert.equal(publishCalls, 2);
      const [failedTarget] = await db.select().from(postTargets).where(eq(postTargets.id, failed.id));
      assert.equal(failedTarget.lastErrorCode, 'AUTH_EXPIRED');
    } finally { registerPublisher(original); }
    delete process.env.X_CLIENT_SECRET; assert(!availableProviders().includes('x')); assert.equal((await start('x')).status, 400);
    const env = process.env as Record<string, string | undefined>; const prior = env.NODE_ENV; env.NODE_ENV = 'production';
    assert.equal(oauthEndpoint('x', '/2/users/me'), 'https://api.x.com/2/users/me'); env.NODE_ENV = prior;
    console.log('OAuth HTTP verification passed: session, origin, PKCE, encrypted channel, reconnect, single-use, expiry, provider/user binding, concurrent replay, worker refresh serialization, token_expired and production override guard.');
  } finally {
    if (workspaceId) await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await db.delete(users).where(eq(users.id, userId)); await db.delete(users).where(eq(users.id, foreignId));
    await close(server); await close(endpoint);
  }
}
main().catch((error: unknown) => { console.error('OAuth verification failed', error); process.exitCode = 1; });
