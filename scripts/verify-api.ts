// Shared origin takes precedence; historical per-script variables remain supported.
if (process.env.VERIFY_BASE_URL) process.env.API_HTTP_URL = process.env.VERIFY_BASE_URL;
import { deleteFixtureUsers } from './fixture-cleanup';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { createHmac, randomBytes } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '../db';
import { apiKeys, apiRateLimits, brands, channels, posts, postTargets, subscriptions, users, sessions, workspaceMembers, webhookDeliveries, webhookEndpoints, workspaces } from '../db/schema';
import { createApiKey, hash } from '../lib/api/auth';
import { createWebhook, manageWebhook, deliverWebhooks, deliverWebhooksTick, emit, sendTestEvent, validateWebhookUrl, webhookEvents } from '../lib/api/webhooks';
import { decideApproval } from '../lib/approvals';
import { notFound } from '../lib/api/routing';
import { savePost } from '../lib/api/post-service';
import { apiError } from '../lib/api/errors';
import { derivePostStatus, tick } from '../lib/publishing';
import * as me from '../app/api/v1/me/route';
import * as brandRoute from '../app/api/v1/brands/route';
import * as channelRoute from '../app/api/v1/brands/[id]/channels/route';
import * as postRoute from '../app/api/v1/posts/route';
import * as detailRoute from '../app/api/v1/posts/[id]/route';
import * as retryRoute from '../app/api/v1/posts/[id]/retry/route';

import * as webhookRoute from '../app/api/v1/webhooks/route';
import * as webhookDetailRoute from '../app/api/v1/webhooks/[id]/route';
import * as webhookTestRoute from '../app/api/v1/webhooks/[id]/test/route';
import * as webhookDeliveryRoute from '../app/api/v1/webhooks/[id]/deliveries/route';
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
    [/^\/api\/v1\/webhooks$/, webhookRoute], [/^\/api\/v1\/webhooks\/([^/]+)$/, webhookDetailRoute],
    [/^\/api\/v1\/webhooks\/([^/]+)\/test$/, webhookTestRoute], [/^\/api\/v1\/webhooks\/([^/]+)\/deliveries$/, webhookDeliveryRoute],
  ].map(([re, mod]) => [re, Object.fromEntries(Object.entries(mod).filter(([, v]) => typeof v === 'function'))]) as [RegExp, Record<string, Handler>][];
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url!, 'http://127.0.0.1');
      const route = routes.find(([pattern]) => pattern.test(url.pathname));
      const handler = route?.[1][req.method!];
      if (!route || !handler) { const r = notFound(); res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(await r.text()); return; }
      const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const response = await handler(new Request(url, {method: req.method, headers: req.headers as Record<string, string>,
        ...(chunks.length ? {body: Buffer.concat(chunks)} : {})}), route[0].exec(url.pathname)?.[1] ? {params: Promise.resolve({id: route[0].exec(url.pathname)![1]})} : {});
      res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer()));
    } catch { res.writeHead(500).end('Harness error'); }
  });
  let receiverCode = 204, receiverDelay = 0, inFlight = 0, peak = 0;
  const received: {body: string; signature: string}[] = [];
  const receiver = createServer(async (req, res) => {
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
    received.push({body: Buffer.concat(chunks).toString(), signature: String(req.headers['x-socialmint-signature'])});
    inFlight++; peak = Math.max(peak, inFlight);
    res.on("close", () => { inFlight--; });
    if (receiverDelay) await new Promise(resolve => setTimeout(resolve, receiverDelay));
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
      {workspaceId: workspace.id, plan: 'agency', status: 'trialing', trialEnd: new Date(Date.now() + 86400000), stripeSubscriptionId: 'test_api_agency_' + userId},
      {workspaceId: starter.id, plan: 'starter', status: 'active', currentPeriodEnd: new Date(Date.now() + 86400000), stripeSubscriptionId: 'test_api_starter_' + userId},
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
    for (const [path, method, status] of [['/nonexistent', 'GET', 404], ['/me', 'POST', 405]] as const) {
      const r = await request(path, {method}); assert.equal(r.status, status);
      assert.equal(r.headers.get('cache-control'), 'no-store'); assert((await r.json()).error.code);
      if (status === 405) assert(r.headers.get('allow')?.includes('GET'));
    }
    await db.update(subscriptions).set({trialEnd: new Date(0)}).where(eq(subscriptions.workspaceId, workspace.id));
    assert.equal((await request('/me')).status, 403);
    await db.update(subscriptions).set({trialEnd: new Date(Date.now() + 86400000)}).where(eq(subscriptions.workspaceId, workspace.id));
    const starterForm = new FormData(); starterForm.set('brandId', foreign.id); starterForm.set('body', 'Starter approval'); starterForm.set('intent', 'draft'); starterForm.set('requiresApproval', 'on');
    await assert.rejects(savePost({db, workspace: starter, userId}, starterForm), e => {
      const r = apiError(e); assert.equal(r.status, 422); return String(e).includes('Included with Agency');
    });
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
    const [foreignChannel] = await db.insert(channels).values({brandId: foreign.id, provider: 'mastodon', displayName: 'Foreign fixture', externalId: userId, credentialsEnc: 'not-used'}).returning();
    for (const id of [foreignChannel.id, crypto.randomUUID()]) {
      const r = await post({...body, channel_ids: [id]}); assert.equal(r.status, 404); assert.equal((await r.json()).error.code, 'not_found');
    }
    const invalidMedia = await post({...body, media_urls: ['https://fixer3.invalid/image.png']});
    assert.equal(invalidMedia.status, 422); assert.match((await invalidMedia.json()).error.message, /media_urls\[0\]/);
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
    const approvalData = JSON.parse(received.find(r => JSON.parse(r.body).event === 'approval.decided')!.body).data;
    assert.deepEqual(Object.keys(approvalData).sort(), ['post_id', 'brand_id', 'decision', 'decided_at', 'has_comment', 'post_url'].sort());
    assert.equal(approvalData.has_comment, false); assert.equal(approvalData.brand_id, brand.id);
    const approvalDetail = await (await request('/posts/' + approval.id)).json();
    assert.equal(approvalDetail.approvals[0].reviewer_name, 'Tester'); assert.equal(approvalDetail.approvals[0].comment, '');
    assert.equal(approvalDetail.approvals[0].decision, 'approved'); assert(approvalDetail.approvals[0].created_at); assert(approvalDetail.approval_url.includes('/r/'));
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

    receiverCode = 204;
    await sendTestEvent(workspace.id, webhook.id);
    await manageWebhook(workspace.id, webhook.id, 'disable');
    let [paused] = await db.select().from(webhookDeliveries).where(and(eq(webhookDeliveries.endpointId, webhook.id), eq(webhookDeliveries.status, 'paused')));
    assert.equal(paused.attempts, 0); assert.equal(paused.nextAttemptAt, null);
    await deliverWebhooks();
    await manageWebhook(workspace.id, webhook.id, 'enable');
    await db.update(subscriptions).set({trialEnd: new Date(0)}).where(eq(subscriptions.workspaceId, workspace.id));
    await deliverWebhooks();
    [paused] = await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.id, paused.id));
    assert.equal(paused.status, 'paused'); assert.equal(paused.attempts, 0); assert.equal(paused.pauseReason, 'Agency access required');
    await db.update(subscriptions).set({trialEnd: new Date(Date.now() + 86400000)}).where(eq(subscriptions.workspaceId, workspace.id));
    const baselineStart = performance.now(); await tick(); const baseline = performance.now() - baselineStart;
    receiverDelay = 1500;
    const dispatch = deliverWebhooksTick();
    const started = performance.now(); await tick(); const duration = performance.now() - started;
    assert(duration < baseline + 500, 'Slow receiver must not extend publishing tick');
    await dispatch; receiverDelay = 0;
    [paused] = await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.id, paused.id)); assert.equal(paused.status, 'delivered');
    await sendTestEvent(workspace.id, webhook.id);
    await manageWebhook(workspace.id, webhook.id, 'delete');
    const canceled = await db.select().from(webhookDeliveries).where(and(eq(webhookDeliveries.endpointId, webhook.id), eq(webhookDeliveries.status, 'canceled')));
    assert.equal(canceled.length, 1); assert.equal(canceled[0].attempts, 0);
    const [deleted] = await db.select().from(webhookEndpoints).where(eq(webhookEndpoints.id, webhook.id)); assert(deleted.deletedAt); assert.equal(deleted.secretEnc, '');
    await assert.rejects(manageWebhook(workspace.id, webhook.id, 'enable'));
    const slow = await createWebhook(workspace.id, receiverUrl, ['post.failed']);
    // Dispatcher backlog fixture is not ten customer test-button requests.
    await db.insert(webhookDeliveries).values(Array.from({length:10},()=>({endpointId:slow.id,event:'ping',payload:{id:crypto.randomUUID(),event:'ping',data:{test:true}}})));
    await db.execute(sql`delete from request_rate_limits where key=${'webhook-test:'+workspace.id}`);
    receiverDelay = 6000; peak = 0;
    const budgetStart = performance.now(); await deliverWebhooksTick(); const budgetDuration = performance.now() - budgetStart;
    assert(peak <= 4); assert(budgetDuration < 10000, 'Ten-second dispatcher budget with bounded DB overhead');
    const slowRows = await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.endpointId, slow.id));
    assert(slowRows.every(d => d.attempts <= 1));
    await manageWebhook(workspace.id, slow.id, 'delete'); receiverDelay = 0;
    console.log(`PASS dispatcher deadline=${budgetDuration.toFixed(0)}ms, peak concurrent HTTP=${peak}, 5s per-request abort`);
    console.log(`PASS E01–E08: payload allowlist, expiry, Starter save rejection, DNS/channel/routing contracts, pause/resume/delete; publishing baseline=${baseline.toFixed(0)}ms slow-receiver=${duration.toFixed(0)}ms`);
    // A separate key proves existing keys do not gain the new scope.
    const whKey = await createApiKey(workspace.id, userId, 'Webhook management', ['webhooks:manage']);
    const whRequest = (path: string, options: RequestInit = {}) => request('/webhooks' + path, options, whKey.token);
    const register = (url = receiverUrl, events: unknown = ['post.failed']) => whRequest('', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({url, events})});
    assert.equal((await request('/webhooks', {}, readKey.token)).status, 403);
    assert.equal((await request('/webhooks')).status, 403);
    for (const url of ['https://169.254.169.254/latest', 'https://127.0.0.1/private', 'not a url']) assert.equal((await register(url)).status, 422);
    assert.equal((await register(receiverUrl, ['ping'])).status, 422);
    assert.equal((await register(receiverUrl, [])).status, 422);
    // Production rejects loopback registration; exercise the same route locally for signed delivery.
    const localRegister = () => fetch(harnessBase + '/api/v1/webhooks', {method: 'POST', headers: {Authorization: 'Bearer ' + whKey.token, 'Content-Type': 'application/json'}, body: JSON.stringify({url: receiverUrl, events: ['post.failed']})});
    if (process.env.API_HTTP_URL) assert.equal((await register()).status, 422);
    const registration = await localRegister(); assert.equal(registration.status, 201);
    const managed = await registration.json(); assert.equal(managed.active, true); assert(managed.secret.startsWith('whsec_'));
    assert.deepEqual(Object.keys(managed).sort(), ['id', 'url', 'events', 'active', 'secret'].sort());
    const listing = await (await whRequest('')).json(); assert(listing.data.some((e: {id: string}) => e.id === managed.id));
    assert(!JSON.stringify(listing).includes('secret')); assert(!JSON.stringify(listing).includes(managed.secret));
    const beforePing = received.length;
    assert.equal((await whRequest('/' + managed.id + '/test', {method: 'POST'})).status, 202);
    await deliverWebhooks(); const ping = received[beforePing]; assert(ping);
    assert.equal(JSON.parse(ping.body).event, 'ping');
    const match = /^t=(\d+),v1=([a-f0-9]{64})$/.exec(ping.signature); assert(match);
    assert.equal(match[2], createHmac('sha256', managed.secret).update(match[1] + '.' + ping.body).digest('hex'));
    const log = await (await whRequest('/' + managed.id + '/deliveries?limit=1')).json();
    assert.equal(log.data.length, 1); assert.equal(log.data[0].status, 'delivered'); assert.equal(log.data[0].event, 'ping'); assert(!JSON.stringify(log).includes('secret'));
    assert.equal((await whRequest('/' + managed.id + '/deliveries?limit=101')).status, 422);
    const [foreignEndpoint] = await db.insert(webhookEndpoints).values({workspaceId: starter.id, url: receiverUrl, events: ['post.failed'], secretHash: '', secretEnc: ''}).returning();
    for (const id of [foreignEndpoint.id, crypto.randomUUID(), 'invalid']) {
      assert.equal((await whRequest('/' + id, {method: 'DELETE'})).status, 404);
      assert.equal((await whRequest('/' + id + '/test', {method: 'POST'})).status, 404);
      assert.equal((await whRequest('/' + id + '/deliveries')).status, 404);
    }
    // Eleven concurrent requests compete for the remaining nine slots.
    const registrations = await Promise.all(Array.from({length: 11}, localRegister));
    assert.equal(registrations.filter(r => r.status === 201).length, 9);
    assert.equal(registrations.filter(r => r.status === 422).length, 2);
    assert.equal((await localRegister()).status, 422);
    assert.equal((await whRequest('/' + managed.id + '/test', {method: 'POST'})).status, 202);
    const deletion = await whRequest('/' + managed.id, {method: 'DELETE'}); assert.equal(deletion.status, 204); assert.equal(await deletion.text(), '');
    const afterDelete = await (await whRequest('/' + managed.id + '/deliveries')).json();
    assert(afterDelete.data.some((d: {status: string; attempts: number}) => d.status === 'canceled' && d.attempts === 0));
    assert(!JSON.stringify(afterDelete).includes(managed.secret));
    assert(!(await (await whRequest('')).json()).data.some((e: {id: string}) => e.id === managed.id));
    assert.equal((await whRequest('/' + managed.id + '/test', {method: 'POST'})).status, 404);
    assert.equal((await localRegister()).status, 201);
    console.log('PASS webhook API: one-time secret, scope isolation, ping signature, delivery logs, tenancy, SSRF, concurrent 10-endpoint limit and delete cancellation');
    await db.delete(apiRateLimits).where(eq(apiRateLimits.keyId, key.id));
    for (let i = 0; i < 60; i++) assert.equal((await request('/me')).status, 200);
    const limited = await request('/me'); assert.equal(limited.status, 429); assert(Number(limited.headers.get('retry-after')) > 0);
    await db.update(apiKeys).set({revokedAt: new Date()}).where(eq(apiKeys.id, key.id));
    assert.equal((await request('/me')).status, 401);
    await db.update(subscriptions).set({plan: 'starter'}).where(eq(subscriptions.workspaceId, workspace.id));
    assert.equal((await request('/me', {}, readKey.token)).status, 403);
    console.log('PASS 60/min persistent limit, Retry-After, revocation and downgrade');
  } finally {
    await deleteFixtureUsers(db).where(eq(users.id, userId));
    await close(server); await close(receiver);
    const leftovers = await db.select().from(workspaces).where(eq(workspaces.ownerUserId, userId)); assert.equal(leftovers.length, 0);
    console.log('PASS fixture cleanup');
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error('API verification failed:', typeof e?.actual === 'number' ? `actual=${e.actual}, expected=${e.expected}` : '', e instanceof Error ? e.stack?.split('\n').filter(l => /^\s+at /.test(l)).join('\n') : 'unknown'); process.exit(1); });
