import { and, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { webhookDeliveries, webhookEndpoints } from '@/db/schema';
import type { ApiContext } from './auth';
import { ApiError, json } from './errors';
import { isUuid } from './input';
import { readJson } from './posts';
import { createWebhook, manageWebhook, sendTestEvent, webhookEvents } from './webhooks';
const fields = {id: webhookEndpoints.id, url: webhookEndpoints.url, events: webhookEndpoints.events, active: webhookEndpoints.active};
async function ownEndpoint(ctx: ApiContext, id?: string, includeDeleted = false) {
  if (!id || !isUuid(id)) throw new ApiError(404, 'not_found', 'Endpoint not found.');
  const [row] = await ctx.db.select(fields).from(webhookEndpoints).where(and(eq(webhookEndpoints.id, id),
    eq(webhookEndpoints.kind, "api"), eq(webhookEndpoints.workspaceId, ctx.workspace.id), includeDeleted ? undefined : isNull(webhookEndpoints.deletedAt)));
  if (!row) throw new ApiError(404, 'not_found', 'Endpoint not found.');
  return row;
}
export async function listWebhooks(_request: Request, ctx: ApiContext) {
  return json({data: await ctx.db.select(fields).from(webhookEndpoints).where(and(eq(webhookEndpoints.kind, "api"), eq(webhookEndpoints.workspaceId, ctx.workspace.id),
    isNull(webhookEndpoints.deletedAt))).orderBy(desc(webhookEndpoints.createdAt), desc(webhookEndpoints.id))});
}
export async function registerWebhook(request: Request, ctx: ApiContext) {
  const parsed = z.object({url: z.string().trim().min(1).max(2048), events: z.array(z.enum(webhookEvents)).min(1).max(4)}).strict().safeParse(await readJson(request));
  if (!parsed.success) throw new ApiError(422, 'validation_error', 'Provide url and 1–4 supported events.');
  return json(await createWebhook(ctx.workspace.id, parsed.data.url, parsed.data.events), 201);
}
export async function deleteWebhook(_request: Request, ctx: ApiContext, id?: string) {
  const row = await ownEndpoint(ctx, id);
  await manageWebhook(ctx.workspace.id, row.id, 'delete');
  return new Response(null, {status: 204, headers: {'Cache-Control': 'no-store'}});
}
export async function testWebhook(_request: Request, ctx: ApiContext, id?: string) {
  const row = await ownEndpoint(ctx, id);
  return json(await sendTestEvent(ctx.workspace.id, row.id), 202);
}
export async function listDeliveries(request: Request, ctx: ApiContext, id?: string) {
  const row = await ownEndpoint(ctx, id, true);
  const parsed = z.object({limit: z.coerce.number().int().min(1).max(100).default(20)}).strict().safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) throw new ApiError(422, 'validation_error', 'Use limit 1–100.');
  return json({data: await ctx.db.select({id: webhookDeliveries.id, event: webhookDeliveries.event, status: webhookDeliveries.status,
    attempts: webhookDeliveries.attempts, response_status: webhookDeliveries.responseStatus, pause_reason: webhookDeliveries.pauseReason,
    next_attempt_at: webhookDeliveries.nextAttemptAt, created_at: webhookDeliveries.createdAt}).from(webhookDeliveries)
    .where(eq(webhookDeliveries.endpointId, row.id)).orderBy(desc(webhookDeliveries.createdAt), desc(webhookDeliveries.id)).limit(parsed.data.limit)});
}
