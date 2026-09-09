import { visibleIdentifier } from '@/lib/text-input';
import { createHash, randomBytes } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { apiKeys, workspaces } from '@/db/schema';
import { workspaceEntitlements } from '@/lib/entitlements';
import { apiRateLimit } from '@/lib/rate-limit';
import { ApiError, apiError } from './errors';
export const scopes = ['posts:write', 'posts:read', 'brands:read', 'webhooks:manage'] as const;
export type Scope = typeof scopes[number];
export const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export async function agencyAccess(workspaceId: string) {
  return (await workspaceEntitlements(workspaceId)).api;
}
export async function requireAgency(workspaceId: string) {
  if (!await agencyAccess(workspaceId)) throw new ApiError(403, 'agency_required', 'API access requires an active Agency plan or Agency trial.');
}
export async function createApiKey(workspaceId: string, userId: string, name: string, selected: string[]) {
  await requireAgency(workspaceId);
  name = visibleIdentifier(name, 'Key name');
  if (!name.trim() || name.trim().length > 80 || !selected.length || selected.some(s => !scopes.includes(s as Scope)))
    throw new ApiError(422, 'validation_error', 'Enter a name (1–80 characters) and valid scopes.');
  const token = 'sm_live_' + randomBytes(32).toString('base64url');
  const key = await getDb().transaction(async tx => {
    await tx.select({id:workspaces.id}).from(workspaces).where(eq(workspaces.id,workspaceId)).for('update');
    const active = await tx.select({id:apiKeys.id}).from(apiKeys).where(and(eq(apiKeys.workspaceId,workspaceId),isNull(apiKeys.revokedAt)));
    if (active.length >= 20) throw new ApiError(422,'key_limit','Maximum 20 active API keys per workspace. Revoke a key first.');
    const [key] = await tx.insert(apiKeys).values({workspaceId, createdByUserId:userId, name:name.trim(),
      keyPrefix:token.slice(8,16),keyHash:hash(token),scopes:[...new Set(selected)]}).returning({id:apiKeys.id});
    return key;
  });
  return {id: key.id, token};
}
export async function authenticate(request: Request, scope?: Scope) {
  const token = request.headers.get('authorization')?.match(/^Bearer (sm_live_[A-Za-z0-9_-]{43})$/i)?.[1];
  if (!token) throw new ApiError(401, 'unauthorized', 'Provide a valid Bearer API key.');
  const db = getDb();
  const [row] = await db.select({key: apiKeys, workspace: workspaces}).from(apiKeys)
    .innerJoin(workspaces, eq(workspaces.id, apiKeys.workspaceId))
    .where(and(eq(apiKeys.keyHash, hash(token)), isNull(apiKeys.revokedAt)));
  if (!row) throw new ApiError(401, 'unauthorized', 'Provide a valid Bearer API key.');
  await requireAgency(row.workspace.id);
  const retry = await apiRateLimit(row.key.id);
  if (retry) throw new ApiError(429, 'rate_limited', 'Limit of 60 requests per minute exceeded.', retry);
  if (scope && !row.key.scopes.includes(scope)) throw new ApiError(403, 'insufficient_scope', `This endpoint requires ${scope}.`);
  await db.update(apiKeys).set({lastUsedAt: new Date()}).where(and(eq(apiKeys.id, row.key.id),
    sql`(${apiKeys.lastUsedAt} is null or ${apiKeys.lastUsedAt} <= now() - interval '1 minute')`));
  return {...row, db, userId: row.key.createdByUserId};
}
export type ApiContext = Awaited<ReturnType<typeof authenticate>>;
export function endpoint(scope: Scope | undefined, handler: (request: Request, ctx: ApiContext, id?: string) => Promise<Response>) {
  return async (request: Request, route?: {params?: Promise<{id?: string}>}) => {
    try { return await handler(request, await authenticate(request, scope), (await route?.params)?.id); }
    catch (e) { return apiError(e, new URL(request.url).pathname === '/api/v1/media' ? '/api/v1/media' : '/api/v1'); }
  };
}
