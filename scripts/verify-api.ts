import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { createHmac, randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { getDb } from '../db';
import { apiKeys, apiRateLimits, brands, channels, posts, postTargets, subscriptions, users, sessions, workspaceMembers, webhookDeliveries, workspaces } from '../db/schema';
import { createApiKey, hash } from '../lib/api/auth';
import { createWebhook, deliverWebhooks, emit, sendTestEvent, validateWebhookUrl, webhookEvents } from '../lib/api/webhooks';
import { decideApproval } from '../lib/approvals';
import { derivePostStatus } from '../lib/publishing';
import * as me from '../app/api/v1/me/route';
import * as brandRoute from '../app/api/v1/brands/route';
import * as channelRoute from '../app/api/v1/brands/[id]/channels/route';
import * as postRoute from '../app/api/v1/posts/route';
import * as detailRoute from '../app/api/v1/posts/[id]/route';
import * as retryRoute from '../app/api/v1/posts/[id]/retry/route';

type Handler = (req: Request, ctx?: {params?: Promise<{id?: string}>}) => Promise<Response>;
async function listen(server: Server) { await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); assert(address && typeof address !== 'string'); return `http://127.0.0.1:${address.port}`; }
async function close(server: Server) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
async function main() {
  assert(process.env.NODE_ENV !== 'production', 'Run against a non-production test database.');
  process.env.APP_ENCRYPTION_KEY ||= randomBytes(32).toString('base64');
  process.env.AUTH_SECRET ||= randomBytes(32).toString('hex');
  process.env.WEBHOOK_ALLOW_LOOPBACK = '1';
  const db = getDb(), userId = crypto.randomUUID();
  const routes: [RegExp, Record<string, Handler>][] = [
    [/^\/api\/v1\/me$/, me], [/^\/api\/v1\/brands$/, brandRoute],
    [/^\/api\/v1\/brands\/([^/]+)\/channels$/, channelRoute], [/^\/api\/v1\/posts$/, postRoute],
    [/^\/api\/v1\/posts\/([^/]+)\/retry$/, retryRoute], [/^\/api\/v1\/posts\/([^/]+)$/, detailRoute],
  ].map(([re, mod]) => [re, Object.fromEntries(Object.entries(mod).filter(([, v]) => typeof v === 'function'))]) as [RegExp, Record<string, Handler>][];
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url!, 'http://127.0.0.1');
      const route = routes.find(([pattern]) => pattern.test(url.pathname));
      const handler = route?.[1][req.method!];
      if (!route || !handler) { res.writeHead(404).end(); return; }
      const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const response = await handler(new Request(url, {method: req.method, headers: req.headers as Record<string, string>,
        ...(chunks.length ? {body: Buffer.concat(chunks)} : {})}), route[0].exec(url.pathname)?.[1] ? {params: Promise.resolve({id: route[0].exec(url.pathname)![1]})} : {});
      res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer()));
    } catch { res.writeHead(500).end('Harness error'); }
  });
  let receiverCode = 204;
  const received: {body: string; signature: string}[] = [];
  const receiver = createServer(async (req, res) => {
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
    received.push({body: Buffer.concat(chunks).toString(), signature: String(req.headers['x-socialmint-signature'])});
    res.writeHead(receiverCode).end();
  });
  const harnessBase = await listen(server), receiverUrl = await listen(receiver);
  const base = process.env.API_HTTP_URL ?? harnessBase;
  process.env.AUTH_URL = base; process.env.NEXT_PUBLIC_APP_URL = base;
  try {
    await db.insert(users).values({id: userId, name: 'API verification fixture'});
    const [workspace, starter] = await db.insert(workspaces).values([
      {name: 'API fixture', slug: 'api-' + userId, ownerUserId: userId},
      {name: 'Starter fixture', slug: 'starter-' + userId, ownerUserId: userId},
    ]).returning();
    await db.insert(subscriptions).values([
      {workspaceId: workspace.id, plan: 'agency', status: 'trialing', stripeSubscriptionId: 'test_api_agency_' + userId},
      {workspaceId: starter.id, plan: 'starter', status: 'active', stripeSubscriptionId: 'test_api_starter_' + userId},
    ]);
    const [brand, foreign] = await db.insert(brands).values([
      {workspaceId: workspace.id, name: 'API brand', slug: 'api'}, {workspaceId: starter.id, name: 'Foreign', slug: 'foreign'},
    ]).returning();
    const [channel] = await db.insert(channels).values({brandId: brand.id, provider: 'mastodon', displayName: 'Fixture channel', externalId: userId, credentialsEnc: 'not-used', meta: {maxTextLength: 500}}).returning();
    const key = await createApiKey(workspace.id, userId, 'Test key', ['posts:write', 'posts:read', 'brands:read']);
    if (process.env.API_HTTP_URL) {
      assert.equal((await fetch(base + '/docs/api')).status, 200);
      assert.equal((await fetch(base + '/openapi.json')).status, 200);
      assert.equal((await fetch(base + '/app/settings/api', {redirect: 'manual'})).status, 307);
      const sessionToken = randomBytes(32).toString('base64url');
      await db.insert(workspaceMembers).values({workspaceId: workspace.id, userId, role: 'owner'});
      await db.insert(sessions).values({sessionToken, userId, expires: new Date(Date.now() + 600000)});
      const settings = await fetch(base + '/app/settings/api', {headers: {Cookie: 'authjs.session-token=' + sessionToken}});
      assert.equal(settings.status, 200); const html = await settings.text();
      assert(html.includes('Create API key')); assert(html.includes('Create webhook'));
      assert(!html.includes(key.token)); assert(!html.includes(hash(key.token)));
      console.log('PASS built Next.js public docs, protected settings and secret-free owner settings HTML');
    }

    const request = (path: string, options: RequestInit = {}, token = key.token) => fetch(base + '/api/v1' + path, {signal: AbortSignal.timeout(15000), ...options, headers: {Authorization: 'Bearer ' + token, ...options.headers}});
    const post = (body: unknown, idem?: string, token = key.token) => request('/posts', {method: 'POST', headers: {'Content-Type': 'application/json', ...(idem ? {'Idempotency-Key': idem} : {})}, body: JSON.stringify(body)}, token);
    assert.equal((await request('/me')).status, 200);
    assert.equal((await fetch(base + '/api/v1/me')).status, 401);
    assert.equal((await request('/me', {}, 'sm_live_' + randomBytes(32).toString('base64url'))).status, 401);
    await assert.rejects(createApiKey(starter.id, userId, 'Forbidden', ['posts:read']));
    const starterToken = 'sm_live_' + randomBytes(32).toString('base64url');
    await db.insert(apiKeys).values({workspaceId: starter.id, createdByUserId: userId, name: 'Legacy', keyHash: hash(starterToken), keyPrefix: starterToken.slice(8, 16), scopes: ['posts:read']});
    assert.equal((await request('/me', {}, starterToken)).status, 403);
    const readKey = await createApiKey(workspace.id, userId, 'Read key', ['posts:read']);
    assert.equal((await post({brand_id: brand.id, body: 'Forbidden'}, undefined, readKey.token)).status, 403);
    const [used] = await db.select().from(apiKeys).where(eq(apiKeys.id, key.id));
    await request('/me');
    const [usedAgain] = await db.select().from(apiKeys).where(eq(apiKeys.id, key.id));
    assert.equal(used.lastUsedAt?.getTime(), usedAgain.lastUsedAt?.getTime());
    assert.equal((await request('/brands')).status, 200);
    const cs = await (await request(`/brands/${brand.id}/channels`)).json();
    assert.equal(cs.data[0].id, channel.id); assert(!JSON.stringify(cs).includes('credentials'));
    assert.equal((await request(`/brands/${foreign.id}/channels`)).status, 404);
    const body = {brand_id: brand.id, body: 'API draft', media_urls: [], channel_ids: []};
    const responses = await Promise.all(Array.from({length: 8}, () => post(body, 'same')));
    assert(responses.every(r => r.status === 201));
    const created = await responses[0].json(); assert.deepEqual(await responses[1].json(), created);
    assert.equal((await db.select().from(posts).where(eq(posts.brandId, brand.id))).length, 1);
    assert.equal((await post({...body, body: 'changed'}, 'same')).status, 409);
    assert.equal((await post({...body, body: ''})).status, 422);
    assert.equal((await post({...body, media_urls: ['https://127.0.0.1/private']})).status, 422);
    assert.equal((await post({...body, brand_id: foreign.id})).status, 404);
    assert.equal((await post({...body, body: 'x'.repeat(501), channel_ids: [channel.id]})).status, 422);
    assert.equal((await post({...body, scheduled_at: 'yesterday'})).status, 422);
    assert.equal((await request('/posts?limit=0')).status, 422);
    const detail = await (await request('/posts/' + created.id)).json(); assert.equal(detail.id, created.id); assert(Array.isArray(detail.targets)); assert.equal(detail.events.length, 1);
    const foreignDraft = await post({...body, body: 'second'}); assert.equal(foreignDraft.status, 201);
    const page = await (await request('/posts?limit=1')).json(); assert.equal(page.data.length, 1); assert(page.next_cursor);
    const page2 = await (await request('/posts?limit=1&cursor=' + page.next_cursor)).json(); assert.equal(page2.data.length, 1); assert.notEqual(page.data[0].id, page2.data[0].id);
    assert.equal((await request('/posts/' + created.id, {method: 'DELETE'})).status, 204);
    assert.equal((await request('/posts/' + created.id)).status, 404);
    assert.deepEqual(await (await post(body, 'same')).json(), created);
    const scheduled = await post({...body, channel_ids: [channel.id], scheduled_at: new Date(Date.now() + 86400000).toISOString()});
    assert.equal(scheduled.status, 201); const schedule = await scheduled.json();
    assert.equal((await request('/posts/' + schedule.id + '/retry', {method: 'POST'})).status, 409);
    await db.update(postTargets).set({status: 'failed', attempts: 5}).where(eq(postTargets.postId, schedule.id));
    await db.update(posts).set({status: 'failed'}).where(eq(posts.id, schedule.id));
    assert.equal((await request('/posts/' + schedule.id, {method: 'DELETE'})).status, 409);
    const retried = await request('/posts/' + schedule.id + '/retry', {method: 'POST'}); assert.equal(retried.status, 200);
    assert.equal((await retried.json()).targets[0].attempts, 0);
    assert.equal((await request('/posts/' + schedule.id, {method: 'DELETE'})).status, 204);
    console.log('PASS auth, scopes, tenancy, shared validation, atomic idempotency, pagination, retry and delete');

    const webhook = await createWebhook(workspace.id, receiverUrl, [...webhookEvents]);
    const approval = await (await post({...body, body: 'Approve me', channel_ids: [channel.id], scheduled_at: 'now', requires_approval: true})).json();
    assert(approval.approval_url); assert.equal(approval.status, 'pending_approval');
    assert.equal((await decideApproval(new URL(approval.approval_url).pathname.split('/').pop()!, {reviewerName: 'Tester', decision: 'approved', comment: ''}, '127.0.0.1')).status, 200);
    let deliveries = await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.endpointId, webhook.id)); assert.equal(deliveries[0].event, 'approval.decided');
    await db.transaction(async tx => { await tx.update(postTargets).set({status: 'published'}).where(eq(postTargets.postId, approval.id)); await derivePostStatus(tx, approval.id); });
    deliveries = await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.endpointId, webhook.id)); assert(deliveries.some(d => d.event === 'post.published'));
    await db.transaction(async tx => { await emit(tx, approval.id, 'post.needs_review', {target_id: channel.id}); await emit(tx, approval.id, 'post.failed'); });
    await deliverWebhooks(); assert.equal(received.length, 4);
    for (const r of received) {
      const match = /^t=(\d+),v1=([a-f0-9]{64})$/.exec(r.signature); assert(match);
      assert.equal(match[2], createHmac('sha256', webhook.secret).update(match[1] + '.' + r.body).digest('hex'));
      assert(Math.abs(Date.now() / 1000 - Number(match[1])) < 10);
    }
    const count = received.length; await Promise.all([deliverWebhooks(), deliverWebhooks()]); assert.equal(received.length, count);
    receiverCode = 500; await sendTestEvent(workspace.id, webhook.id); await deliverWebhooks();
    let [failed] = await db.select().from(webhookDeliveries).where(and(eq(webhookDeliveries.endpointId, webhook.id), eq(webhookDeliveries.status, 'pending')));
    assert.equal(failed.attempts, 1); assert.equal(failed.responseStatus, 500); assert(failed.nextAttemptAt!.getTime() - Date.now() > 55000);
    for (let attempt = 2; attempt <= 5; attempt++) {
      await db.update(webhookDeliveries).set({nextAttemptAt: new Date(Date.now() - 1000)}).where(eq(webhookDeliveries.id, failed.id));
      await deliverWebhooks(); [failed] = await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.id, failed.id));
      assert.equal(failed.attempts, attempt);
      if (attempt < 5) assert(failed.nextAttemptAt!.getTime() - Date.now() > (attempt === 2 ? 295000 : 1795000));
    }
    assert.equal(failed.status, 'failed'); assert.equal(failed.nextAttemptAt, null);
    process.env.WEBHOOK_ALLOW_LOOPBACK = '0'; await assert.rejects(validateWebhookUrl(receiverUrl));
    process.env.WEBHOOK_ALLOW_LOOPBACK = '1'; const oldNodeEnv = process.env.NODE_ENV;
    Object.assign(process.env, {NODE_ENV: 'production'}); await assert.rejects(validateWebhookUrl(receiverUrl));
    if (oldNodeEnv === undefined) Reflect.deleteProperty(process.env, "NODE_ENV"); else Object.assign(process.env, {NODE_ENV: oldNodeEnv});
    await assert.rejects(validateWebhookUrl('https://169.254.169.254/latest')); await assert.rejects(validateWebhookUrl('https://user:password@example.com'));
    console.log('PASS approval/publishing outbox, delivery signatures, concurrent claims, 1/5/30/30 backoff, five-attempt limit, production SSRF guard');

    await db.delete(apiRateLimits).where(eq(apiRateLimits.keyId, key.id));
    for (let i = 0; i < 60; i++) assert.equal((await request('/me')).status, 200);
    const limited = await request('/me'); assert.equal(limited.status, 429); assert(Number(limited.headers.get('retry-after')) > 0);
    await db.update(apiKeys).set({revokedAt: new Date()}).where(eq(apiKeys.id, key.id));
    assert.equal((await request('/me')).status, 401);
    await db.update(subscriptions).set({plan: 'starter'}).where(eq(subscriptions.workspaceId, workspace.id));
    assert.equal((await request('/me', {}, readKey.token)).status, 403);
    console.log('PASS 60/min persistent limit, Retry-After, revocation and downgrade');
  } finally {
    await db.delete(users).where(eq(users.id, userId));
    await close(server); await close(receiver);
    const leftovers = await db.select().from(workspaces).where(eq(workspaces.ownerUserId, userId)); assert.equal(leftovers.length, 0);
    console.log('PASS fixture cleanup');
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error('API verification failed:', typeof e?.actual === 'number' ? `actual=${e.actual}, expected=${e.expected}` : '', e instanceof Error ? e.stack?.split('\n').filter(l => /^\s+at /.test(l)).join('\n') : 'unknown'); process.exit(1); });
