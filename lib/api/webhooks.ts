import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { and, eq, lt, lte, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { apiIdempotency, brands, posts, webhookDeliveries, webhookEndpoints } from '@/db/schema';
import { decryptCredentials, encryptCredentials } from '@/lib/crypto';
import { safeFetch, validatePublicUrl } from '@/lib/publishers/safe-fetch';
import { agencyAccess, hash, requireAgency } from './auth';
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
  if (!loopback(value)) await validatePublicUrl(value);
}
export async function createWebhook(workspaceId: string, url: string, events: string[]) {
  await requireAgency(workspaceId);
  if (!events.length || events.some(e => !webhookEvents.includes(e as WebhookEvent))) throw new ApiError(422, 'validation_error', 'Choose valid webhook events.');
  await validateWebhookUrl(url);
  const secret = 'whsec_' + randomBytes(32).toString('base64url');
  const [endpoint] = await getDb().insert(webhookEndpoints).values({workspaceId, url, events: [...new Set(events)], secretHash: hash(secret), secretEnc: encryptCredentials({secret})}).returning({id: webhookEndpoints.id});
  return {id: endpoint.id, secret};
}
/** Transactional outbox: never perform network IO while writing post history. */
export async function emit(tx: Tx, postId: string, event: WebhookEvent, data: Record<string, unknown> = {}) {
  const [row] = await tx.select({workspaceId: brands.workspaceId}).from(posts).innerJoin(brands, eq(brands.id, posts.brandId)).where(eq(posts.id, postId));
  if (!row) return;
  const endpoints = await tx.select({id: webhookEndpoints.id, events: webhookEndpoints.events}).from(webhookEndpoints)
    .where(and(eq(webhookEndpoints.workspaceId, row.workspaceId), eq(webhookEndpoints.active, true)));
  const payload = {id: randomUUID(), event, created_at: new Date().toISOString(), data: {post_id: postId, ...data}};
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
  const [endpoint] = await getDb().select().from(webhookEndpoints).where(and(eq(webhookEndpoints.id, endpointId), eq(webhookEndpoints.workspaceId, workspaceId), eq(webhookEndpoints.active, true)));
  if (!endpoint) throw new ApiError(404, 'not_found', 'Active endpoint not found.');
  const event = endpoint.events[0];
  await getDb().insert(webhookDeliveries).values({endpointId, event, payload: {id: randomUUID(), event, created_at: new Date().toISOString(), data: {test: true}}});
}
export const signature = (secret: string, timestamp: string, body: string) => `t=${timestamp},v1=${createHmac('sha256', secret).update(timestamp + '.' + body).digest('hex')}`;
export async function deliverWebhooks() {
  const db = getDb();
  await db.delete(apiIdempotency).where(lte(apiIdempotency.expiresAt, new Date()));
  // A committed lease avoids duplicate claims; attempt number fences expired workers.
  const claimed = await db.transaction(async tx => {
    await tx.update(webhookDeliveries).set({status: 'failed', nextAttemptAt: null})
      .where(and(eq(webhookDeliveries.status, 'pending'), sql`${webhookDeliveries.attempts} >= 5`, lte(webhookDeliveries.nextAttemptAt, new Date())));
    const rows = await tx.select({delivery: webhookDeliveries, endpoint: webhookEndpoints}).from(webhookDeliveries)
      .innerJoin(webhookEndpoints, eq(webhookEndpoints.id, webhookDeliveries.endpointId))
      .where(and(eq(webhookDeliveries.status, 'pending'), eq(webhookEndpoints.active, true), lt(webhookDeliveries.attempts, 5), lte(webhookDeliveries.nextAttemptAt, new Date())))
      .orderBy(webhookDeliveries.nextAttemptAt).limit(10).for('update', {of: webhookDeliveries, skipLocked: true});
    for (const {delivery} of rows) await tx.update(webhookDeliveries).set({attempts: delivery.attempts + 1, nextAttemptAt: new Date(Date.now() + 120000)})
      .where(eq(webhookDeliveries.id, delivery.id));
    return rows;
  });
  await Promise.all(claimed.map(async ({delivery, endpoint}) => {
    let responseStatus: number | null = null;
    let ok = false;
    try {
      if (!await agencyAccess(endpoint.workspaceId)) throw new Error('Agency required');
      const body = JSON.stringify(delivery.payload), timestamp = String(Math.floor(Date.now() / 1000));
      const init: RequestInit = {method: 'POST', body, headers: {'Content-Type': 'application/json',
        'X-SocialMint-Delivery': delivery.id, 'X-SocialMint-Signature': signature(decryptCredentials(endpoint.secretEnc).secret, timestamp, body)}, signal: AbortSignal.timeout(20000)};
      const response = loopback(endpoint.url)
        ? await fetch(endpoint.url, {...init, redirect: 'manual'})
        : await safeFetch(endpoint.url, init);
      responseStatus = response.status; ok = response.ok;
      await response.body?.cancel();
    } catch { /* Persist safe status only; remote responses and secrets never enter logs. */ }
    const attempt = delivery.attempts + 1;
    await db.update(webhookDeliveries).set({status: ok ? 'delivered' : attempt >= 5 ? 'failed' : 'pending', responseStatus,
      nextAttemptAt: ok || attempt >= 5 ? null : new Date(Date.now() + [1, 5, 30, 30][attempt - 1] * 60000)})
      .where(and(eq(webhookDeliveries.id, delivery.id), eq(webhookDeliveries.attempts, attempt), eq(webhookDeliveries.status, 'pending')));
  }));
  return {claimed: claimed.length};
}
