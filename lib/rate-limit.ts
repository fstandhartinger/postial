import ipaddr from 'ipaddr.js';
import { getDb } from "@/db";
import { apiRateLimits } from "@/db/schema";
import { sql } from "drizzle-orm";
import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';
import { ApiError } from '@/lib/api/errors';
/** Atomic fixed windows in PostgreSQL, shared by every replica. Keys contain no raw IP. */
export async function sharedRateLimit(key: string, limit: number, seconds: number): Promise<number> {
  const [row] = await getDb().execute(sql`insert into request_rate_limits (key, attempts, expires_at)
    values (${key}, 1, now() + ${seconds} * interval '1 second')
    on conflict (key) do update set
      attempts = case when request_rate_limits.expires_at <= now() then 1 else least(request_rate_limits.attempts + 1, ${limit + 1}) end,
      expires_at = case when request_rate_limits.expires_at <= now() then now() + ${seconds} * interval '1 second' else request_rate_limits.expires_at end
    returning attempts, greatest(1, ceil(extract(epoch from (expires_at - now())))) as retry`);
  return Number(row.attempts) > limit ? Number(row.retry) : 0;
}
export const billingRateLimit = (userId: string) => sharedRateLimit('billing:' + userId, 5, 60);
export async function sessionActionBudget(userId: string) {
  const retry = await sharedRateLimit('session:' + userId, 120, 60);
  if (retry) throw new ApiError(429,'rate_limited','Maximum 120 actions per minute. Please wait.',retry);
}
/** The ingress contract used by public anonymous endpoints. */
export function trustedClientIp(headers: Headers): string {
  const forwarded = process.env.APPROVAL_TRUST_PROXY === 'true' ? headers.get('x-real-ip') : null;
  return forwarded && isIP(forwarded) ? ipaddr.process(forwarded).toNormalizedString() : 'untrusted-peer';
}

/** Stable, secret-keyed identity for shared rate-limit keys and safe log hints. */
export function rateLimitIdentityHash(identity: string): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error('AUTH_SECRET is required');
  return createHmac('sha256', secret).update(identity).digest('hex');
}

export async function anonymousLimit(headers: Headers, path: string, limit: number) {
  const key = rateLimitIdentityHash(trustedClientIp(headers));
  const retry = await sharedRateLimit('anonymous:' + path + ':' + key, limit, 60);
  return retry ? Response.json({error:{code:'rate_limited',message:'Too many requests. Please wait.'}},
    {status:429,headers:{'Retry-After':String(retry),'Cache-Control':'no-store'}}) : null;
}

// API budgets are atomic and shared across replicas, unlike the billing budget.
export async function apiRateLimit(keyId: string): Promise<number> {
  const [row] = await getDb().insert(apiRateLimits).values({keyId, expiresAt: new Date(Date.now() + 60000)})
    .onConflictDoUpdate({target: apiRateLimits.keyId, set: {
      attempts: sql`case when ${apiRateLimits.expiresAt} <= now() then 1 else least(${apiRateLimits.attempts} + 1, 61) end`,
      expiresAt: sql`case when ${apiRateLimits.expiresAt} <= now() then now() + interval '1 minute' else ${apiRateLimits.expiresAt} end`,
    }}).returning();
  return row.attempts > 60 ? Math.max(1, Math.ceil((row.expiresAt.getTime() - Date.now()) / 1000)) : 0;
}
