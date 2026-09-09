import { and, asc, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { approvalDecisions, apiIdempotency, brands, channels, postEvents, posts, postStatus, postTargets } from '@/db/schema';
import { appUrl } from '@/lib/stripe';
import { workspaceEntitlements } from '@/lib/entitlements';
import { ApiError, json } from './errors';
import { hash, type ApiContext } from './auth';
import { changeTarget, reschedulePost, isUuid, savePost, type Tx } from './post-service';
const input = z.object({
  brand_id: z.string().uuid(), body: z.string(), media_urls: z.array(z.string()).max(4).default([]),
  link_url: z.string().optional(), channel_ids: z.array(z.string().uuid()).max(100).default([]),
  scheduled_at: z.union([z.literal('now'), z.string().datetime({offset: true})]).optional(),
  requires_approval: z.boolean().default(false),
}).strict();
export function postJson(post: typeof posts.$inferSelect) {
  return {id: post.id, brand_id: post.brandId, body: post.body, media_urls: post.mediaUrls,
    link_url: post.linkUrl, scheduled_at: post.scheduledAt, status: post.status,
    requires_approval: post.requiresApproval, created_at: post.createdAt, updated_at: post.updatedAt};
}
export async function ownBrand(ctx: ApiContext, id: string, tx = ctx.db as Tx | typeof ctx.db) {
  if (!isUuid(id)) throw new ApiError(404, 'not_found', 'Brand not found.');
  const [brand] = await tx.select().from(brands).where(and(eq(brands.id, id), eq(brands.workspaceId, ctx.workspace.id)));
  if (!brand) throw new ApiError(404, 'not_found', 'Brand not found.');
  return brand;
}
export async function ownPost(ctx: ApiContext, id: string, tx = ctx.db as Tx | typeof ctx.db, lock = false) {
  if (!isUuid(id)) throw new ApiError(404, 'not_found', 'Post not found.');
  const query = tx.select({post: posts}).from(posts).innerJoin(brands, eq(brands.id, posts.brandId))
    .where(and(eq(posts.id, id), eq(brands.workspaceId, ctx.workspace.id)));
  const [row] = await (lock ? query.for('update', {of: posts}) : query);
  if (!row) throw new ApiError(404, 'not_found', 'Post not found.');
  return row.post;
}
export async function getPost(_request: Request, ctx: ApiContext, id?: string) {
  const post = await ownPost(ctx, id!);
  const targets = await ctx.db.select({id: postTargets.id, channel_id: postTargets.channelId, status: postTargets.status,
    remote_url: postTargets.remoteUrl, last_error_human: postTargets.lastErrorHuman, attempts: postTargets.attempts,
    warnings: postTargets.warnings}).from(postTargets).where(eq(postTargets.postId, post.id));
  const events = await ctx.db.select({id: postEvents.id, target_id: postEvents.targetId, type: postEvents.type,
    message: postEvents.message, created_at: postEvents.createdAt}).from(postEvents).where(eq(postEvents.postId, post.id)).orderBy(asc(postEvents.createdAt), asc(postEvents.id));
  const approvals = await ctx.db.select({decision: approvalDecisions.decision, reviewer_name: approvalDecisions.reviewerName,
    comment: approvalDecisions.comment, created_at: approvalDecisions.createdAt, decided_at: approvalDecisions.createdAt}).from(approvalDecisions)
    .where(eq(approvalDecisions.postId, post.id)).orderBy(asc(approvalDecisions.createdAt), asc(approvalDecisions.id));
  return json({...postJson(post), targets, events, approvals, ...(post.requiresApproval ? {approval_url: post.approvalToken ? `${appUrl()}/r/${post.approvalToken}` : null} : {})});
}
export async function listPosts(request: Request, ctx: ApiContext) {
  const q = new URL(request.url).searchParams;
  const parsed = z.object({brand_id: z.string().uuid().optional(), status: z.enum(postStatus.enumValues).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20), cursor: z.string().uuid().optional()}).safeParse(Object.fromEntries(q));
  if (!parsed.success) throw new ApiError(422, 'validation_error', 'Invalid brand_id, status, limit (1–100) or cursor.');
  const {brand_id, status, limit, cursor} = parsed.data;
  if (brand_id) await ownBrand(ctx, brand_id);
  const rows = await ctx.db.select({post: posts}).from(posts).innerJoin(brands, eq(brands.id, posts.brandId))
    .where(and(eq(brands.workspaceId, ctx.workspace.id), brand_id ? eq(posts.brandId, brand_id) : undefined,
      status ? eq(posts.status, status) : undefined, cursor ? gt(posts.id, cursor) : undefined)).orderBy(asc(posts.id)).limit(limit + 1);
  return json({data: rows.slice(0, limit).map(r => postJson(r.post)), next_cursor: rows.length > limit ? rows[limit - 1].post.id : null});
}
export async function readJson(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(422, 'validation_error', 'JSON body required.');
  let text = ''; const decoder = new TextDecoder(); let size = 0;
  try {
    while (true) { const {done, value} = await reader.read(); if (done) break; size += value.byteLength;
      if (size > 512000) throw new ApiError(413, 'payload_too_large', 'Request exceeds 512 KB.'); text += decoder.decode(value, {stream: true}); }
    text += decoder.decode();
  } finally { await reader.cancel(); }
  try { return JSON.parse(text); } catch { throw new ApiError(422, 'validation_error', 'Invalid JSON.'); }
}
export async function createPost(request: Request, ctx: ApiContext) {
  const parsed = input.safeParse(await readJson(request));
  if (!parsed.success) throw new ApiError(422, 'validation_error', parsed.error.issues[0].message);
  const data = parsed.data, idem = request.headers.get('idempotency-key');
  if (idem !== null && (!/^[\x21-\x7e]{1,200}$/.test(idem))) throw new ApiError(422, 'validation_error', 'Idempotency-Key must contain 1–200 printable non-space ASCII characters.');
  const requestHash = hash(JSON.stringify(data));
  const serviceContext = {...ctx, access: await workspaceEntitlements(ctx.workspace)};
  const response = await ctx.db.transaction(async tx => {
    if (idem) {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${ctx.key.id + ':' + idem}, 0))`);
      const [old] = await tx.select().from(apiIdempotency).where(and(eq(apiIdempotency.keyId, ctx.key.id), eq(apiIdempotency.key, idem)));
      if (old && old.expiresAt.getTime() > Date.now()) {
        if (old.requestHash !== requestHash) throw new ApiError(409, 'idempotency_conflict', 'This key was used with a different request.');
        return old.response;
      }
    }
    await ownBrand(ctx, data.brand_id, tx);
    const form = new FormData();
    for (const [k, v] of Object.entries({brandId: data.brand_id, body: data.body, mediaUrls: data.media_urls.join('\n'),
      linkUrl: data.link_url ?? '', intent: data.scheduled_at ? 'publish' : 'draft', when: data.scheduled_at === 'now' ? 'now' : 'later',
      scheduledAt: data.scheduled_at ?? '', requiresApproval: data.requires_approval ? 'on' : ''})) form.set(k, v);
    data.channel_ids.forEach(id => form.append('channelId', id));
    const id = await savePost(serviceContext, form, true, tx);
    const post = await ownPost(ctx, id, tx);
    const result = JSON.parse(JSON.stringify({...postJson(post), ...(post.approvalToken ? {approval_url: `${appUrl()}/r/${post.approvalToken}`} : {})}));
    if (idem) await tx.insert(apiIdempotency).values({keyId: ctx.key.id, key: idem, requestHash, response: result, expiresAt: new Date(Date.now() + 86400000)})
      .onConflictDoUpdate({target: [apiIdempotency.keyId, apiIdempotency.key], set: {requestHash, response: result, expiresAt: new Date(Date.now() + 86400000)}});
    return result;
  });
  return json(response, 201);
}
export async function deletePost(_request: Request, ctx: ApiContext, id?: string) {
  const access = await workspaceEntitlements(ctx.workspace);
  await ctx.db.transaction(async tx => {
    const post = await ownPost(ctx, id!, tx, true);
    if (!access.activeBrandIds.includes(post.brandId)) throw new ApiError(403, 'brand_read_only', 'This brand is read-only under your plan.');
    const targets = await tx.select().from(postTargets).where(eq(postTargets.postId, post.id)).for('update');
    if (!['draft', 'scheduled'].includes(post.status) || targets.some(t => t.attempts > 0 || ['publishing', 'published'].includes(t.status)))
      throw new ApiError(409, 'invalid_status', 'Only drafts and scheduled posts that have not started publishing can be deleted.');
    await tx.delete(posts).where(eq(posts.id, post.id));
  });
  return new Response(null, {status: 204, headers: {'Cache-Control': 'no-store'}});
}
export async function retryPost(request: Request, ctx: ApiContext, id?: string) {
  const serviceContext = {...ctx, access: await workspaceEntitlements(ctx.workspace)};
  await ctx.db.transaction(async tx => {
    const post = await ownPost(ctx, id!, tx, true);
    const targets = await tx.select().from(postTargets).where(and(eq(postTargets.postId, post.id),
      inArray(postTargets.status, ['failed', 'needs_review', 'held', 'queued']))).orderBy(asc(postTargets.id)).for('update');
    const retryable = targets.filter(t => t.status !== 'queued' || t.lastErrorCode);
    if (!retryable.length) throw new ApiError(409, 'invalid_status', 'No failed targets to retry.');
    for (const t of retryable) { const form = new FormData(); form.set('targetId', t.id); await changeTarget(serviceContext, form, 'retry', tx); }
  });
  return getPost(request, ctx, id);
}
export async function listBrands(_request: Request, ctx: ApiContext) {
  return json({data: await ctx.db.select({id: brands.id, name: brands.name, slug: brands.slug, timezone: brands.timezone, color: brands.color})
    .from(brands).where(eq(brands.workspaceId, ctx.workspace.id)).orderBy(desc(brands.createdAt))});
}
export async function listChannels(_request: Request, ctx: ApiContext, id?: string) {
  await ownBrand(ctx, id!);
  return json({data: await ctx.db.select({id: channels.id, provider: channels.provider, display_name: channels.displayName, status: channels.status, url: channels.url})
    .from(channels).where(eq(channels.brandId, id!))});
}

export async function patchPost(request: Request, ctx: ApiContext, id?: string) {
  const parsed = z.object({scheduled_at:z.string().datetime({offset:true})}).strict().safeParse(await readJson(request));
  if (!parsed.success) throw new ApiError(422,'validation_error','Provide scheduled_at as an ISO date with timezone.');
  await ownPost(ctx,id!);
  await reschedulePost(ctx,id!,parsed.data.scheduled_at);
  return getPost(request,ctx,id);
}
