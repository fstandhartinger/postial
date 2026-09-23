import { deleteFixtureUsers } from './fixture-cleanup';
// Local HTTP + real PostgreSQL. All X/Meta endpoints are replaced by a loopback server.
import './test-runtime';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import { createRequestStoreForAPI } from 'next/dist/server/async-storage/request-store';
import { workUnitAsyncStorage } from 'next/dist/server/app-render/work-unit-async-storage.external';
import { workAsyncStorage, type WorkStore } from 'next/dist/server/app-render/work-async-storage.external';
import { getDb } from '../db';
import { brands, channels, funnelEvents, oauthStates, posts, postTargets, subscriptions, sessions, users, workspaceMembers, workspaces } from '../db/schema';
import { decryptCredentials, encryptCredentials } from '../lib/crypto';
import { tick } from '../lib/publishing';
import { oauthEndpoint } from '../lib/publishers/oauth-config';
import { availableProviders, getPublisher, registerPublisher } from '../lib/publishers';
import { decryptFacebookPick } from '../lib/publishers/oauth';
async function listen(server: Server) { await new Promise<void>(r => server.listen(0, '127.0.0.1', r)); return `http://127.0.0.1:${(server.address() as { port: number }).port}`; }
async function close(server: Server) { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); }
async function main() {
  assert.notEqual(process.env.NODE_ENV, 'production');
  process.env.AUTH_SECRET = randomBytes(32).toString('hex');
  process.env.CRON_SECRET = randomBytes(32).toString('hex');
  process.env.AUTH_TRUST_HOST = 'true';
  process.env.APP_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  process.env.X_CLIENT_ID = 'local-x'; process.env.X_CLIENT_SECRET = 'local-x-secret';
  process.env.THREADS_APP_ID = 'local-threads'; process.env.THREADS_APP_SECRET = 'local-threads-secret';
  process.env.LINKEDIN_CLIENT_ID = 'local-linkedin'; process.env.LINKEDIN_CLIENT_SECRET = 'local-linkedin-secret';
  process.env.FACEBOOK_APP_ID = 'local-facebook'; process.env.FACEBOOK_APP_SECRET = 'local-facebook-secret';
  process.env.TIKTOK_CLIENT_KEY = 'local-tiktok'; process.env.TIKTOK_CLIENT_SECRET = 'local-tiktok-secret';
  const db = getDb(), userId = crypto.randomUUID(), foreignId = crypto.randomUUID(), sessionToken = randomBytes(32).toString('hex');
  let tokenFailure = false;
  // Phase switches: Meta may omit expires_in on the long-lived exchange; non-FB/IG strictness must not change (CH-FB-5).
  let omitFacebookLongExpiresIn = false, omitLinkedinExpiresIn = false;
  // Facebook Page fixtures: the accounts payload switches per phase; /me answers the Page whose token authorizes the request.
  type AccountsPayload = { data: unknown[]; paging?: { next?: string } };
  const singlePage: AccountsPayload = { data: [{ id: 'facebook-page', name: 'Facebook Test', access_token: 'facebook-page-token', instagram_business_account: { id: 'ig-account', username: 'ig.test' } }] };
  let accountsResponse: (url: URL) => AccountsPayload = () => singlePage;
  const pageTokens: Record<string, { id: string; name: string }> = {
    'facebook-page-token': { id: 'facebook-page', name: 'Facebook Test' },
    'facebook-page-token-2': { id: 'facebook-page-2', name: 'Facebook Second' },
    'facebook-page-p1-token': { id: 'facebook-page-p1', name: 'Paginated One' },
  };
  const requests: { path: string; body: URLSearchParams }[] = [];
  const endpoint = createServer(async (req, res) => {
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const url = new URL(req.url!, 'http://127.0.0.1'), body = new URLSearchParams(Buffer.concat(chunks).toString());
    requests.push({ path: url.pathname, body });
    if (tokenFailure) { res.writeHead(503, {'Content-Type':'application/json'}).end('{}'); return; }
    // Facebook reuses one GET endpoint for the code and the long-lived exchange, split by grant_type.
    if (url.pathname === '/v21.0/oauth/access_token') {
      const long = url.searchParams.get('grant_type') === 'fb_exchange_token';
      res.writeHead(200, {'Content-Type':'application/json'});
      res.end(JSON.stringify(long
        ? (omitFacebookLongExpiresIn ? { access_token: 'facebook-long' } : { access_token: 'facebook-long', expires_in: 5184000 })
        : { access_token: 'facebook-short', expires_in: 3600 }));
      return;
    }
    if (url.pathname === '/v21.0/me/accounts') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(accountsResponse(url))); return; }
    if (url.pathname === '/v21.0/me') { const page = pageTokens[(req.headers.authorization ?? '').replace(/^Bearer\s+/, '')]; res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(page ?? {})); return; }
    if (url.pathname === '/oauth/v2/accessToken') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(omitLinkedinExpiresIn ? { access_token: 'linkedin-access' } : { access_token: 'linkedin-access', expires_in: 5184000 }));
      return;
    }
    const responses: Record<string, unknown> = {
      '/2/oauth2/token': { access_token: 'x-access', refresh_token: 'x-refresh', expires_in: 7200 },
      '/2/users/me': { data: { id: 'x-account', username: 'test' } },
      '/oauth/access_token': { access_token: 'threads-short' },
      '/access_token': { access_token: 'threads-long', expires_in: 5184000 },
      '/v1.0/me': { id: 'threads-account', username: 'test' },
      '/v2/userinfo': { sub: 'linkedin-account', name: 'LinkedIn Test', vanityName: 'linkedin-test' },
      '/v21.0/ig-account': { id: 'ig-account', username: 'ig.test' },
      '/v2/oauth/token/': { access_token: 'tiktok-access', refresh_token: 'tiktok-refresh', expires_in: 86400, open_id: 'tiktok-account' },
      '/v2/user/info/': { data: { user: { open_id: 'tiktok-account', display_name: 'TikTok Test' } } },
    };
    res.writeHead(responses[url.pathname] ? 200 : 404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(responses[url.pathname] ?? {}));
  });
  const endpointUrl = await listen(endpoint);
  process.env.X_API_BASE_URL = endpointUrl; process.env.THREADS_API_BASE_URL = endpointUrl; process.env.LINKEDIN_API_BASE_URL = endpointUrl; process.env.FACEBOOK_API_BASE_URL = endpointUrl; process.env.INSTAGRAM_API_BASE_URL = endpointUrl; process.env.TIKTOK_API_BASE_URL = endpointUrl;
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
    appUrl = await listen(server); process.env.APP_URL = appUrl; process.env.AUTH_URL = appUrl; process.env.NEXT_PUBLIC_APP_URL = appUrl;
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
    for (const provider of ['x', 'threads', 'linkedin', 'facebook', 'instagram', 'tiktok'] as const) {
      const started = await start(provider); assert.equal(started.status, 303);
      const url = new URL(started.headers.get('location')!), state = url.searchParams.get('state')!;
      assert.equal(url.searchParams.get('redirect_uri'), `${appUrl}/api/oauth/${provider}/callback`);
      const [saved] = await db.select().from(oauthStates).where(eq(oauthStates.state, state));
      assert.equal(saved.userId, userId); assert.equal(saved.brandId, brand.id);
      assert(saved.expiresAt.getTime() <= Date.now() + 600000);
      if (provider === 'x' || provider === 'tiktok') {
        assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
        assert.equal(url.searchParams.get('code_challenge'), createHash('sha256').update(decryptCredentials(saved.codeVerifier).verifier).digest('base64url'));
      }
      if (provider === 'tiktok') {
        assert.equal(url.origin + url.pathname, 'https://www.tiktok.com/v2/auth/authorize/');
        assert.equal(url.searchParams.get('client_key'), 'local-tiktok');
        assert.equal(url.searchParams.get('scope'), 'user.info.basic,video.publish,video.upload');
      }
      assert.match((await callback(provider, state, '')).headers.get('location')!, /connect_error=expired$/);
      assert.match((await callback(provider, state, `authjs.session-token=${foreignToken}`)).headers.get('location')!, /connect_error=expired$/);
      assert.match((await callback(provider === 'x' ? 'threads' : 'x', state)).headers.get('location')!, /connect_error=expired$/);
      const completed = await callback(provider, state); assert.equal(completed.status, 303);
      assert(completed.headers.get('location')?.includes(`/app/brands/${brand.id}`));
      const [channel] = await db.select().from(channels).where(and(eq(channels.brandId, brand.id), eq(channels.provider, provider)));
      assert.equal(channel.status, 'active'); assert(!channel.credentialsEnc.includes('access'));
      const credentials = decryptCredentials(channel.credentialsEnc); assert(Number(credentials.expiresAt) > Date.now());
      assert.equal(credentials.accessToken, { x: 'x-access', threads: 'threads-long', linkedin: 'linkedin-access', facebook: 'facebook-page-token', instagram: 'facebook-page-token', tiktok: 'tiktok-access' }[provider]);
      if (provider === 'facebook') assert.equal(credentials.externalId, 'facebook-page');
      if (provider === 'instagram') assert.equal(credentials.externalId, 'ig-account');
      if (provider === 'tiktok') assert.equal(credentials.externalId, 'tiktok-account');
      const before = requests.length; assert.match((await callback(provider, state)).headers.get('location')!, /connect_error=expired$/); assert.equal(requests.length, before);
      const restarted = new URL((await start(provider)).headers.get('location')!);
      const race = await Promise.all([callback(provider, restarted.searchParams.get('state')!), callback(provider, restarted.searchParams.get('state')!)]);
      assert(race.every(r => r.status === 303)); assert.equal(race.filter(r => r.headers.get('location')?.includes('connect_error=expired')).length, 1);
      assert.equal((await db.select().from(channels).where(and(eq(channels.brandId, brand.id), eq(channels.provider, provider)))).length, 1);
      const expired = new URL((await start(provider)).headers.get('location')!).searchParams.get('state')!;
      await db.update(oauthStates).set({ expiresAt: new Date(0) }).where(eq(oauthStates.state, expired));
      assert.match((await callback(provider, expired)).headers.get('location')!, /connect_error=expired$/);
    }
    // CH-FB-4: Facebook Page selection. The accounts payload switches per phase.
    const { chooseFacebookPage } = await import('../app/app/brands/[id]/facebook-pages/actions');
    const pickerPage = (await import('../app/app/brands/[id]/facebook-pages/page')).default;
    const { renderToStaticMarkup } = await import('react-dom/server');
    const requestScope = async (cookie: string, run: () => Promise<unknown>): Promise<unknown> => {
      const scopeUrl = new URL(`${appUrl}/app/brands/_`);
      const request = new NextRequest(scopeUrl, { headers: { cookie } });
      const store = createRequestStoreForAPI(request, { pathname: scopeUrl.pathname, search: scopeUrl.search }, { tags: [], expirationsByCacheKind: new Map() }, undefined, undefined, undefined);
      return workAsyncStorage.run({ route: scopeUrl.pathname, page: scopeUrl.pathname, isStaticGeneration: false } as WorkStore, () => workUnitAsyncStorage.run(store, run));
    };
    // The real server action, called with a session cookie: identity comes from the session only.
    const chooseRedirect = async (form: FormData, cookie = headers.cookie): Promise<string> => {
      try { await requestScope(cookie, () => chooseFacebookPage(form)); } catch (error) {
        const digest = (error as { digest?: unknown }).digest;
        if (typeof digest === 'string' && digest.startsWith('NEXT_REDIRECT;')) return digest.split(';')[2];
        throw error;
      }
      throw new Error('chooseFacebookPage did not redirect');
    };
    // Each scenario brand replaces the previous one so the fixture workspace stays inside its plan's active-brand limit.
    const scenarioBrands: string[] = [];
    const newBrand = async (slug: string) => {
      if (scenarioBrands.length) await db.delete(brands).where(inArray(brands.id, scenarioBrands.splice(0)));
      const [created] = await db.insert(brands).values({ workspaceId: workspaceId!, name: slug, slug }).returning();
      scenarioBrands.push(created.id);
      return created;
    };
    const finishFacebook = async (brandId: string) => {
      const start = await fetch(`${appUrl}/api/oauth/facebook/start`, { method: 'POST', headers, body: new URLSearchParams({ brandId }), redirect: 'manual' });
      if (!start.headers.get('location')) throw new Error(`Facebook start answered ${start.status}: ${await start.text()}`);
      const started = new URL(start.headers.get('location')!);
      return fetch(`${appUrl}/api/oauth/facebook/callback?state=${started.searchParams.get('state')}&code=mock-code`, { headers, redirect: 'manual' });
    };
    const pickRowsFor = (brandId: string) => db.select().from(oauthStates).where(and(eq(oauthStates.provider, 'facebook:pick'), eq(oauthStates.brandId, brandId)));
    const fbChannelsFor = (brandId: string) => db.select().from(channels).where(and(eq(channels.brandId, brandId), eq(channels.provider, 'facebook')));
    const connectedCount = async () => (await db.select({ id: funnelEvents.id }).from(funnelEvents).where(and(eq(funnelEvents.event, 'channel_connected'), eq(funnelEvents.workspaceId, workspace.id)))).length;
    const pickForm = (pick: string, brandId: string, pageId: string) => { const form = new FormData(); form.set('pick', pick); form.set('brandId', brandId); form.set('pageId', pageId); return form; };
    // Captures console.error lines (e.g. oauth_connect_failed) for exactly one operation, restoring the original handler afterwards.
    const captureErrors = async <T>(run: () => Promise<T>): Promise<{ result: T; lines: string[] }> => {
      const lines: string[] = [];
      const original = console.error;
      console.error = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
      try { return { result: await run(), lines }; } finally { console.error = original; }
    };
    const pickLocation = async (slug: string) => {
      const brand = await newBrand(slug);
      const completed = await finishFacebook(brand.id);
      assert.equal(completed.status, 303);
      const url = new URL(completed.headers.get('location')!);
      assert.equal(url.origin, appUrl);
      assert.equal(url.pathname, `/app/brands/${brand.id}/facebook-pages`);
      const pickValue = url.searchParams.get('pick')!;
      assert.match(pickValue, /^[A-Za-z0-9_-]{43}$/);
      return { brand, pick: pickValue };
    };
    // (b) Two Pages offered: no channel yet, exactly one bound pick row, expiry within ten minutes, tokens stay encrypted.
    accountsResponse = () => ({ data: [
      { id: 'facebook-page', name: 'Facebook Test', access_token: 'facebook-page-token' },
      { id: 'facebook-page-2', name: 'Facebook Second', access_token: 'facebook-page-token-2' },
    ] });
    const pickFunnelBefore = await connectedCount();
    const { brand: pickBrand, pick } = await pickLocation('oauth-fb-pick');
    assert.equal((await fbChannelsFor(pickBrand.id)).length, 0);
    const [pickRow] = await pickRowsFor(pickBrand.id);
    assert(pickRow);
    assert.equal((await pickRowsFor(pickBrand.id)).length, 1);
    assert.equal(pickRow.userId, userId); assert.equal(pickRow.brandId, pickBrand.id);
    assert(pickRow.expiresAt.getTime() <= Date.now() + 600000);
    assert(!pickRow.codeVerifier.includes('facebook-page-token'));
    assert(!pickRow.codeVerifier.includes('facebook-page-token-2'));
    assert.equal(await connectedCount(), pickFunnelBefore);
    // (f) The normal callback can never consume a pick row.
    const pickReplay = await fetch(`${appUrl}/api/oauth/facebook/callback?state=${pick}&code=mock-code`, { headers, redirect: 'manual' });
    assert.match(pickReplay.headers.get('location')!, /connect_error=expired$/);
    assert.equal((await pickRowsFor(pickBrand.id)).length, 1);
    assert.equal((await fbChannelsFor(pickBrand.id)).length, 0);
    // (c) Choosing the second Page connects exactly that Page, once.
    const beforeChoose = await connectedCount();
    assert.equal(await chooseRedirect(pickForm(pick, pickBrand.id, 'facebook-page-2')), `/app/brands/${pickBrand.id}?connected=facebook`);
    const chosenChannels = await fbChannelsFor(pickBrand.id);
    assert.equal(chosenChannels.length, 1);
    assert.equal(chosenChannels[0].externalId, 'facebook-page-2');
    assert.equal(decryptCredentials(chosenChannels[0].credentialsEnc).accessToken, 'facebook-page-token-2');
    assert.equal((await pickRowsFor(pickBrand.id)).length, 0);
    assert.equal(await connectedCount(), beforeChoose + 1);
    // (d) A spent pick stays spent.
    assert.equal(await chooseRedirect(pickForm(pick, pickBrand.id, 'facebook-page-2')), `/app/brands/${pickBrand.id}?connect_error=expired`);
    assert.equal((await fbChannelsFor(pickBrand.id)).length, 1);
    assert.equal(await connectedCount(), beforeChoose + 1);
    // (d2) Concurrent submits race for exactly one channel and one funnel event.
    const race = await pickLocation('oauth-fb-pick-race');
    const raceBefore = await connectedCount();
    const raced = (await Promise.all([chooseRedirect(pickForm(race.pick, race.brand.id, 'facebook-page-2')), chooseRedirect(pickForm(race.pick, race.brand.id, 'facebook-page-2'))])).sort();
    assert.deepEqual(raced, [`/app/brands/${race.brand.id}?connect_error=expired`, `/app/brands/${race.brand.id}?connected=facebook`]);
    assert.equal((await fbChannelsFor(race.brand.id)).length, 1);
    assert.equal(await connectedCount(), raceBefore + 1);
    // (e) Foreign user, mismatched brand, unknown Page and an expired row never create a channel.
    const foreign = await pickLocation('oauth-fb-pick-foreign');
    assert.equal(await chooseRedirect(pickForm(foreign.pick, foreign.brand.id, 'facebook-page-2'), `authjs.session-token=${foreignToken}`), `/app/brands/${foreign.brand.id}?connect_error=expired`);
    assert.equal((await pickRowsFor(foreign.brand.id)).length, 1);
    assert.equal((await fbChannelsFor(foreign.brand.id)).length, 0);
    const other = await pickLocation('oauth-fb-pick-other');
    assert.equal(await chooseRedirect(pickForm(other.pick, brand.id, 'facebook-page-2')), `/app/brands/${brand.id}?connect_error=expired`);
    assert.equal((await pickRowsFor(other.brand.id)).length, 1);
    assert.equal((await fbChannelsFor(other.brand.id)).length, 0);
    const unknown = await pickLocation('oauth-fb-pick-unknown');
    assert.equal(await chooseRedirect(pickForm(unknown.pick, unknown.brand.id, 'facebook-page-unknown')), `/app/brands/${unknown.brand.id}?connect_error=expired`);
    assert.equal((await pickRowsFor(unknown.brand.id)).length, 0);
    assert.equal((await fbChannelsFor(unknown.brand.id)).length, 0);
    const expiredPick = await pickLocation('oauth-fb-pick-expired');
    await db.update(oauthStates).set({ expiresAt: new Date(0) }).where(eq(oauthStates.state, expiredPick.pick));
    assert.equal(await chooseRedirect(pickForm(expiredPick.pick, expiredPick.brand.id, 'facebook-page-2')), `/app/brands/${expiredPick.brand.id}?connect_error=expired`);
    assert.equal((await fbChannelsFor(expiredPick.brand.id)).length, 0);
    // (g)(g2)(g3) Pagination: the second response repeats one Page id, adds another, and lists an entry without a token.
    accountsResponse = url => (url.searchParams.get('after') === 'cursor-2'
      ? { data: [
          { id: 'facebook-page', name: 'Facebook Test', access_token: 'facebook-page-token' },
          { id: 'facebook-page-p1', name: 'Paginated One', access_token: 'facebook-page-p1-token' },
          { id: 'facebook-page-no-token', name: 'No token' },
        ] }
      : { data: [{ id: 'facebook-page', name: 'Facebook Test', access_token: 'facebook-page-token' }],
          paging: { next: `${endpointUrl}/v21.0/me/accounts?fields=id,name,access_token&limit=100&after=cursor-2` } });
    const paginated = await pickLocation('oauth-fb-pick-paginated');
    const [paginatedRow] = await pickRowsFor(paginated.brand.id);
    assert(paginatedRow);
    assert.deepEqual(decryptFacebookPick(paginatedRow.codeVerifier).pages.map(page => page.id), ['facebook-page', 'facebook-page-p1']);
    assert(!paginatedRow.codeVerifier.includes('facebook-page-p1-token'));
    // CH-FB-4-UI: the picker renders Page names only; an expired selection asks to reconnect.
    const renderPicker = async (brandId: string, pickValue: string) => renderToStaticMarkup(
      (await requestScope(headers.cookie, () => pickerPage({ params: Promise.resolve({ id: brandId }), searchParams: Promise.resolve({ pick: pickValue }) })) as Parameters<typeof renderToStaticMarkup>[0]));
    const pickerHtml = await renderPicker(paginated.brand.id, paginated.pick);
    assert(pickerHtml.includes('Facebook Test'));
    assert(pickerHtml.includes('Paginated One'));
    assert(pickerHtml.includes('Choose the Facebook Page to connect'));
    for (const token of ['facebook-page-token', 'facebook-page-p1-token']) assert(!pickerHtml.includes(token));
    const expiredPickerHtml = await renderPicker(pickBrand.id, pick);
    assert(expiredPickerHtml.includes('This Page selection expired. Connect Facebook again.'));
    assert(expiredPickerHtml.includes(`/app/brands/${pickBrand.id}`));
    accountsResponse = () => ({ data: [] });
    accountsResponse = () => ({ data: [{ id: 'facebook-page-no-token', name: 'No Token' }] });
    const zeroPick = await finishFacebook((await newBrand('oauth-fb-zero')).id);
    assert.match(zeroPick.headers.get('location')!, /connect_error=provider_error$/);
    const zeroPickState = new URL(zeroPick.headers.get('location')!);
    assert.equal(zeroPickState.searchParams.has('pick'), false);
    accountsResponse = () => singlePage;
    // (i) CH-FB-5: single-Page Facebook connect with expires_in omitted from the long-token response still connects under the 60-day fallback.
    omitFacebookLongExpiresIn = true;
    const loneNoExpiry = await newBrand('oauth-fb-single-no-expiry');
    const loneNoExpiryFunnelBefore = await connectedCount();
    const loneNoExpiryDone = await finishFacebook(loneNoExpiry.id);
    assert.equal(new URL(loneNoExpiryDone.headers.get('location')!).pathname, `/app/brands/${loneNoExpiry.id}`);
    assert.match(loneNoExpiryDone.headers.get('location')!, /\?connected=facebook$/);
    const loneNoExpiryChannels = await fbChannelsFor(loneNoExpiry.id);
    assert.equal(loneNoExpiryChannels.length, 1);
    assert.equal(loneNoExpiryChannels[0].externalId, 'facebook-page');
    assert.equal(decryptCredentials(loneNoExpiryChannels[0].credentialsEnc).accessToken, 'facebook-page-token');
    assert(Math.abs(Number(decryptCredentials(loneNoExpiryChannels[0].credentialsEnc).expiresAt) - (Date.now() + 5184000000)) < 60000);
    assert.equal((await pickRowsFor(loneNoExpiry.id)).length, 0);
    assert.equal(await connectedCount(), loneNoExpiryFunnelBefore + 1);
    omitFacebookLongExpiresIn = false;
    // (a) A single Page keeps connecting directly with the same token and external id as before.
    const lone = await newBrand('oauth-fb-single');
    const loneDone = await finishFacebook(lone.id);
    assert.equal(new URL(loneDone.headers.get('location')!).pathname, `/app/brands/${lone.id}`);
    assert.match(loneDone.headers.get('location')!, /\?connected=facebook$/);
    const [loneChannel] = await fbChannelsFor(lone.id);
    assert(loneChannel);
    assert.equal(loneChannel.externalId, 'facebook-page');
    assert.equal(decryptCredentials(loneChannel.credentialsEnc).accessToken, 'facebook-page-token');
    assert.equal((await pickRowsFor(lone.id)).length, 0);
    // (j) CH-FB-5: multi-Page pick with expires_in omitted — the pick row stores the fallback and choosing a Page connects exactly one channel.
    omitFacebookLongExpiresIn = true;
    accountsResponse = () => ({ data: [
      { id: 'facebook-page', name: 'Facebook Test', access_token: 'facebook-page-token' },
      { id: 'facebook-page-2', name: 'Facebook Second', access_token: 'facebook-page-token-2' },
    ] });
    const noExpiryFunnelBefore = await connectedCount();
    const noExpiry = await pickLocation('oauth-fb-pick-no-expiry');
    const [noExpiryRow] = await pickRowsFor(noExpiry.brand.id);
    assert(noExpiryRow);
    assert.equal(decryptFacebookPick(noExpiryRow.codeVerifier).expiresIn, '5184000');
    assert(!noExpiryRow.codeVerifier.includes('facebook-page-token'));
    assert.equal(await chooseRedirect(pickForm(noExpiry.pick, noExpiry.brand.id, 'facebook-page-2')), `/app/brands/${noExpiry.brand.id}?connected=facebook`);
    const noExpiryChannels = await fbChannelsFor(noExpiry.brand.id);
    assert.equal(noExpiryChannels.length, 1);
    assert.equal(noExpiryChannels[0].externalId, 'facebook-page-2');
    assert.equal(decryptCredentials(noExpiryChannels[0].credentialsEnc).accessToken, 'facebook-page-token-2');
    assert(Math.abs(Number(decryptCredentials(noExpiryChannels[0].credentialsEnc).expiresAt) - (Date.now() + 5184000000)) < 60000);
    assert.equal((await pickRowsFor(noExpiry.brand.id)).length, 0);
    assert.equal(await connectedCount(), noExpiryFunnelBefore + 1);
    accountsResponse = () => singlePage;
    omitFacebookLongExpiresIn = false;
    // (l) CH-FB-5: Instagram connect with expires_in omitted from the long-token response still connects under the 60-day fallback.
    omitFacebookLongExpiresIn = true;
    const igNoExpiry = await newBrand('oauth-ig-no-expiry');
    const igNoExpiryStart = await fetch(`${appUrl}/api/oauth/instagram/start`, { method: 'POST', headers, body: new URLSearchParams({ brandId: igNoExpiry.id }), redirect: 'manual' });
    assert.equal(igNoExpiryStart.status, 303);
    const igNoExpiryState = new URL(igNoExpiryStart.headers.get('location')!).searchParams.get('state')!;
    const igNoExpiryDone = await fetch(`${appUrl}/api/oauth/instagram/callback?state=${igNoExpiryState}&code=mock-code`, { headers, redirect: 'manual' });
    assert.equal(igNoExpiryDone.status, 303);
    assert.match(igNoExpiryDone.headers.get('location')!, /\?connected=instagram$/);
    const [igNoExpiryChannel] = await db.select().from(channels).where(and(eq(channels.brandId, igNoExpiry.id), eq(channels.provider, 'instagram')));
    assert(igNoExpiryChannel);
    assert.equal(igNoExpiryChannel.externalId, 'ig-account');
    assert.equal(decryptCredentials(igNoExpiryChannel.credentialsEnc).accessToken, 'facebook-page-token');
    assert(Math.abs(Number(decryptCredentials(igNoExpiryChannel.credentialsEnc).expiresAt) - (Date.now() + 5184000000)) < 60000);
    omitFacebookLongExpiresIn = false;
    // (k) CH-FB-5: a failing provider exchange logs exactly one secrets-free structured line (finishAuth catch and chooser catch).
    const failBrand = await newBrand('oauth-fb-exchange-fail');
    const failStart = await fetch(`${appUrl}/api/oauth/facebook/start`, { method: 'POST', headers, body: new URLSearchParams({ brandId: failBrand.id }), redirect: 'manual' });
    assert.equal(failStart.status, 303);
    const failState = new URL(failStart.headers.get('location')!).searchParams.get('state')!;
    const [failPending] = await db.select().from(oauthStates).where(eq(oauthStates.state, failState));
    const failVerifier = decryptCredentials(failPending.codeVerifier).verifier;
    tokenFailure = true;
    const failCapture = await captureErrors(() => callback('facebook', failState)).finally(() => { tokenFailure = false; });
    assert.equal(failCapture.result.status, 303);
    assert.match(failCapture.result.headers.get('location')!, /connect_error=provider_error$/);
    const failLines = failCapture.lines.filter(line => line.includes('oauth_connect_failed'));
    assert.equal(failLines.length, 1);
    assert(failLines[0].includes('"provider":"facebook"'));
    assert(failLines[0].includes(failBrand.id));
    assert(failLines[0].includes('"code":"PROVIDER_DOWN"'));
    for (const secret of ['facebook-long', 'facebook-short', 'facebook-page-token', 'facebook-page-token-2', 'mock-code', failState, failVerifier]) assert(!failLines[0].includes(secret));
    assert.equal((await fbChannelsFor(failBrand.id)).length, 0);
    // Chooser catch folded in: a failing connect while choosing a Page logs the same secrets-free line.
    accountsResponse = () => ({ data: [
      { id: 'facebook-page', name: 'Facebook Test', access_token: 'facebook-page-token' },
      { id: 'facebook-page-2', name: 'Facebook Second', access_token: 'facebook-page-token-2' },
    ] });
    const chooserFail = await pickLocation('oauth-fb-pick-fail');
    tokenFailure = true;
    const chooserFailCapture = await captureErrors(() => chooseRedirect(pickForm(chooserFail.pick, chooserFail.brand.id, 'facebook-page-2'))).finally(() => { tokenFailure = false; });
    assert.equal(chooserFailCapture.result, `/app/brands/${chooserFail.brand.id}?connect_error=provider_error`);
    const chooserFailLines = chooserFailCapture.lines.filter(line => line.includes('oauth_connect_failed'));
    assert.equal(chooserFailLines.length, 1);
    assert(chooserFailLines[0].includes('"provider":"facebook"'));
    assert(chooserFailLines[0].includes(chooserFail.brand.id));
    assert(chooserFailLines[0].includes('"code":"PROVIDER_DOWN"'));
    for (const secret of ['facebook-page-token', 'facebook-page-token-2']) assert(!chooserFailLines[0].includes(secret));
    assert.equal((await fbChannelsFor(chooserFail.brand.id)).length, 0);
    accountsResponse = () => singlePage;
    // (m) CH-FB-5 STRICTNESS INVARIANT: a non-FB/IG exchange (LinkedIn) whose token response omits expires_in still fails with provider_error — tokenCredentials stays strict.
    const strictBrand = await newBrand('oauth-li-strict');
    const strictStart = await fetch(`${appUrl}/api/oauth/linkedin/start`, { method: 'POST', headers, body: new URLSearchParams({ brandId: strictBrand.id }), redirect: 'manual' });
    assert.equal(strictStart.status, 303);
    const strictState = new URL(strictStart.headers.get('location')!).searchParams.get('state')!;
    omitLinkedinExpiresIn = true;
    const strictCapture = await captureErrors(() => callback('linkedin', strictState)).finally(() => { omitLinkedinExpiresIn = false; });
    assert.equal(strictCapture.result.status, 303);
    assert.match(strictCapture.result.headers.get('location')!, /connect_error=provider_error$/);
    assert.equal((await db.select().from(channels).where(and(eq(channels.brandId, strictBrand.id), eq(channels.provider, 'linkedin')))).length, 0);
    const strictLines = strictCapture.lines.filter(line => line.includes('oauth_connect_failed'));
    assert.equal(strictLines.length, 1);
    assert(strictLines[0].includes('"provider":"linkedin"'));
    assert(strictLines[0].includes('"code":"AUTH_EXPIRED"'));
    for (const secret of ['linkedin-access', strictState]) assert(!strictLines[0].includes(secret));
    assert.equal(requests.find(r => r.path === '/2/oauth2/token')?.body.get('grant_type'), 'authorization_code');
    assert.equal(requests.find(r => r.path === '/oauth/access_token')?.body.get('client_id'), 'local-threads');
    const tiktokExchange = requests.find(r => r.path === '/v2/oauth/token/');
    assert.equal(tiktokExchange?.body.get('grant_type'), 'authorization_code');
    assert.equal(tiktokExchange?.body.get('client_key'), 'local-tiktok');
    assert.equal(tiktokExchange?.body.get('code_verifier')?.length, 43);
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
    await deleteFixtureUsers(db).where(eq(users.id, userId)); await deleteFixtureUsers(db).where(eq(users.id, foreignId));
    await close(server); await close(endpoint);
  }
}
main().catch((error: unknown) => { console.error('OAuth verification failed', error); process.exitCode = 1; });
