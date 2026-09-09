import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { and, eq, lt, lte, sql, inArray, isNull } from 'drizzle-orm';
import { getDb } from '@/db';
import { apiIdempotency, brands, posts, webhookDeliveries, webhookEndpoints, workspaces } from '@/db/schema';
import { decryptCredentials, encryptCredentials } from '@/lib/crypto';
import { safeFetch, validatePublicUrl } from '@/lib/publishers/safe-fetch';
import { agencyAccess, hash, requireAgency } from './auth';
import { appUrl } from '@/lib/stripe';
import { ApiError } from './errors';
import type { Tx } from './post-service';
export const webhookEvents = ['post.published', 'post.failed', 'post.needs_review', 'approval.decided'] as const;
export type WebhookEvent = typeof webhookEvents[number];
function loopback(value: string) {
  if (process.env.NODE_ENV === 'production' || process.env.WEBHOOK_ALLOW_LOOPBACK !== '1') return false;
  const url = new URL(value);
  return url.protocol === 'http:' && url.hostname === '127.0.0.1' && !url.username && !url.password;
}
export async function validateWebhookUrl(value: string) {
  if (value.length > 2048) throw new ApiError(422, 'validation_error', 'URL is too long.');
  try { if (!loopback(value)) await validatePublicUrl(value); }
  catch { throw new ApiError(422, 'validation_error', 'Use a public HTTPS webhook URL.'); }
}
export async function createWebhook(workspaceId: string, url: string, events: string[]) {
  await requireAgency(workspaceId);
  if (!events.length || events.some(e => !webhookEvents.includes(e as WebhookEvent))) throw new ApiError(422, 'validation_error', 'Choose valid webhook events.');
  await validateWebhookUrl(url);
  const secret = 'whsec_' + randomBytes(32).toString('base64url');
  return getDb().transaction(async tx => {
    await tx.select({id: workspaces.id}).from(workspaces).where(eq(workspaces.id, workspaceId)).for('update');
    const existing = await tx.select({id: webhookEndpoints.id}).from(webhookEndpoints)
      .where(and(eq(webhookEndpoints.workspaceId, workspaceId), isNull(webhookEndpoints.deletedAt)));
    if (existing.length >= 10) throw new ApiError(422, 'validation_error', 'Maximum 10 webhook endpoints per workspace.');
    const [endpoint] = await tx.insert(webhookEndpoints).values({workspaceId, url, events: [...new Set(events)], secretHash: hash(secret), secretEnc: encryptCredentials({secret})})
      .returning({id: webhookEndpoints.id, url: webhookEndpoints.url, events: webhookEndpoints.events, active: webhookEndpoints.active});
    return {...endpoint, secret};
  });
}
/** Transactional outbox: never perform network IO while writing post history. */
export async function emit(tx: Tx, postId: string, event: WebhookEvent, data: Record<string, unknown> = {}) {
  const [row] = await tx.select({workspaceId: brands.workspaceId, brandId: brands.id}).from(posts).innerJoin(brands, eq(brands.id, posts.brandId)).where(eq(posts.id, postId));
  if (!row) return;
  const endpoints = await tx.select({id: webhookEndpoints.id, events: webhookEndpoints.events}).from(webhookEndpoints)
    .where(and(eq(webhookEndpoints.workspaceId, row.workspaceId), eq(webhookEndpoints.active, true))).for('share');
  // Never persist caller-supplied free text; each event has an explicit allowlist.
  const fields: Record<WebhookEvent, string[]> = {
    'approval.decided': ['decision', 'decided_at', 'has_comment'],
    'post.published': ['status'], 'post.failed': ['status'], 'post.needs_review': ['target_id'],
  };
  const safe = Object.fromEntries(fields[event].filter(key => key in data).map(key => [key, data[key]]));
  const payload = {id: randomUUID(), event, created_at: new Date().toISOString(), data: {post_id: postId,
    ...(event === 'approval.decided' ? {brand_id: row.brandId, post_url: `${appUrl()}/app/posts/${postId}`} : {}), ...safe}};
  const selected = endpoints.filter(e => e.events.includes(event));
  if (selected.length) await tx.insert(webhookDeliveries).values(selected.map(e => ({endpointId: e.id, event, payload})));
}
/** Called by the publishing aggregate after post_events has been written. */
export async function emitPublishing(tx: Tx, postId: string, previousStatus: string, status: string) {
  if (previousStatus !== status && ['published', 'failed', 'partially_failed'].includes(status))
    await emit(tx, postId, status === 'published' ? 'post.published' : 'post.failed', {status});

}
export async function sendTestEvent(workspaceId: string, endpointId: string) {
  await requireAgency(workspaceId);
  return getDb().transaction(async tx => {
    const [endpoint] = await tx.select({id: webhookEndpoints.id}).from(webhookEndpoints).where(and(eq(webhookEndpoints.id, endpointId), eq(webhookEndpoints.workspaceId, workspaceId), eq(webhookEndpoints.active, true), isNull(webhookEndpoints.deletedAt))).for('share');
    if (!endpoint) throw new ApiError(404, 'not_found', 'Active endpoint not found.');
    const event = 'ping';
    const [delivery] = await tx.insert(webhookDeliveries).values({endpointId, event, payload: {id: randomUUID(), event, created_at: new Date().toISOString(), data: {test: true}}}).returning({id: webhookDeliveries.id});
    return {id: delivery.id, event, status: 'pending'};
  });
}
export const signature = (secret: string, timestamp: string, body: string) => `t=${timestamp},v1=${createHmac('sha256', secret).update(timestamp + '.' + body).digest('hex')}`;
/** Soft deletion preserves the canceled delivery audit trail and destroys signing credentials. */
export async function manageWebhook(workspaceId: string, endpointId: string, action: 'disable' | 'enable' | 'delete') {
  if (action === 'enable') await requireAgency(workspaceId);
  await getDb().transaction(async tx => {
    const [endpoint] = await tx.select().from(webhookEndpoints).where(and(eq(webhookEndpoints.id, endpointId),
      eq(webhookEndpoints.workspaceId, workspaceId), isNull(webhookEndpoints.deletedAt))).for('update');
    if (!endpoint) throw new ApiError(404, 'not_found', 'Endpoint not found.');
    await tx.update(webhookEndpoints).set({active: action === 'enable', ...(action === 'delete' ? {
      deletedAt: new Date(), secretEnc: '', secretHash: '',
    } : {})}).where(eq(webhookEndpoints.id, endpointId));
    await tx.update(webhookDeliveries).set({status: action === 'enable' ? 'pending' : action === 'delete' ? 'canceled' : 'paused',
      pauseReason: action === 'enable' ? null : action === 'delete' ? 'Endpoint deleted' : 'Endpoint disabled',
      nextAttemptAt: action === 'enable' ? new Date() : null})
      .where(and(eq(webhookDeliveries.endpointId, endpointId), inArray(webhookDeliveries.status, ['pending', 'paused'])));
  });
}
let dispatcherRunning = false;
export async function deliverWebhooksTick() {
  if (dispatcherRunning) return {claimed: 0};
  dispatcherRunning = true;
  try { return await deliverWebhooks(); } finally { dispatcherRunning = false; }
}
export async function deliverWebhooks() {
  // Reserve 200 ms of the 10 s tick budget for fenced result writes.
  const db = getDb(), deadline = Date.now() + 9800;
  const budgetSignal = AbortSignal.timeout(9800);
  await db.delete(apiIdempotency).where(lte(apiIdempotency.expiresAt, new Date()));
  // Entitlement pauses do not consume network attempts. Resume automatically after recovery.
  const endpoints = await db.select().from(webhookEndpoints).where(and(eq(webhookEndpoints.active, true), isNull(webhookEndpoints.deletedAt)));
  for (const endpoint of endpoints) {
    if (Date.now() >= deadline) return {claimed: 0};
    const allowed = await agencyAccess(endpoint.workspaceId);
    await db.transaction(async tx => {
      // Serialize automatic resume with Disable/Delete and new outbox events.
      const [current] = await tx.select({active: webhookEndpoints.active}).from(webhookEndpoints)
        .where(eq(webhookEndpoints.id, endpoint.id)).for('update');
      if (!current?.active) return;
      await tx.update(webhookDeliveries).set({status: allowed ? 'pending' : 'paused', pauseReason: allowed ? null : 'Agency access required', nextAttemptAt: allowed ? new Date() : null})
        .where(and(eq(webhookDeliveries.endpointId, endpoint.id), allowed
          ? and(eq(webhookDeliveries.status, 'paused'), eq(webhookDeliveries.pauseReason, 'Agency access required'))
          : eq(webhookDeliveries.status, 'pending')));
    });
  }
  let total = 0;
  // At most four network requests at once; every request shares the ten-second deadline.
  while (Date.now() + 250 < deadline && !budgetSignal.aborted && total < 10) {
    const claimed = await db.transaction(async tx => {
      await tx.update(webhookDeliveries).set({status: 'failed', nextAttemptAt: null})
        .where(and(eq(webhookDeliveries.status, 'pending'), sql`${webhookDeliveries.attempts} >= 5`, lte(webhookDeliveries.nextAttemptAt, new Date())));
      const rows = await tx.select({delivery: webhookDeliveries, endpoint: webhookEndpoints}).from(webhookDeliveries)
        .innerJoin(webhookEndpoints, eq(webhookEndpoints.id, webhookDeliveries.endpointId))
        .where(and(eq(webhookDeliveries.status, 'pending'), eq(webhookEndpoints.active, true), lt(webhookDeliveries.attempts, 5), lte(webhookDeliveries.nextAttemptAt, new Date())))
        .orderBy(webhookDeliveries.nextAttemptAt).limit(Math.min(4, 10 - total)).for('update', {of: webhookDeliveries, skipLocked: true});
      const ready: typeof rows = [];
      for (const row of rows) {
        if (!await agencyAccess(row.endpoint.workspaceId)) {
          await tx.update(webhookDeliveries).set({status: 'paused', pauseReason: 'Agency access required', nextAttemptAt: null}).where(eq(webhookDeliveries.id, row.delivery.id));
        } else if (Date.now() + 250 < deadline && !budgetSignal.aborted) {
          await tx.update(webhookDeliveries).set({attempts: row.delivery.attempts + 1, nextAttemptAt: new Date(Date.now() + 120000)}).where(eq(webhookDeliveries.id, row.delivery.id));
          ready.push(row);
        }
      }
      return ready;
    });
    if (!claimed.length) break;
    total += claimed.length;
    await Promise.all(claimed.map(async ({delivery, endpoint}) => {
      let responseStatus: number | null = null;
      let ok = false;
      try {
        const body = JSON.stringify(delivery.payload), timestamp = String(Math.floor(Date.now() / 1000));
        const init: RequestInit = {method: 'POST', body, headers: {'Content-Type': 'application/json',
          'X-SocialMint-Delivery': delivery.id, 'X-SocialMint-Signature': signature(decryptCredentials(endpoint.secretEnc).secret, timestamp, body)},
          signal: AbortSignal.any([budgetSignal, AbortSignal.timeout(5000)])};
        const response = loopback(endpoint.url) ? await fetch(endpoint.url, {...init, redirect: 'manual'}) : await safeFetch(endpoint.url, init);
        responseStatus = response.status; ok = response.ok;
        await response.body?.cancel();
      } catch { /* Persist safe status only; never remote bodies or secrets. */ }
      const attempt = delivery.attempts + 1;
      await db.update(webhookDeliveries).set({status: ok ? 'delivered' : attempt >= 5 ? 'failed' : 'pending', responseStatus,
        nextAttemptAt: ok || attempt >= 5 ? null : new Date(Date.now() + [1, 5, 30, 30][attempt - 1] * 60000)})
        .where(and(eq(webhookDeliveries.id, delivery.id), eq(webhookDeliveries.attempts, attempt), eq(webhookDeliveries.status, 'pending')));
    }));
  }
  return {claimed: total};
}
