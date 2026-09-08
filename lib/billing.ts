import { billingRateLimit } from '@/lib/rate-limit';
import { eq, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { subscriptions, workspaces } from '@/db/schema';
import { billingState } from '@/db/billing-schema';
import { auth } from '@/auth';
import { ensureWorkspace } from '@/lib/workspaces';
import { appUrl } from '@/lib/stripe';
export { plans } from '@/lib/plans';
export type BillingTransaction = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];
export async function lockWorkspace(tx: BillingTransaction, id: string) {
  await tx.execute(sql`set local lock_timeout = '3s'`);
  await tx.execute(sql`set local statement_timeout = '5s'`);
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`socialmint-billing:${id}`}, 0))`);
}
export async function getSubscriptionForWorkspace(workspaceId: string) {
  const [row] = await getDb().select({ subscription: subscriptions, pastDueSince: billingState.pastDueSince })
    .from(subscriptions).leftJoin(billingState, eq(billingState.workspaceId, subscriptions.workspaceId))
    .where(eq(subscriptions.workspaceId, workspaceId)).limit(1);
  return row ? { ...row.subscription, pastDueSince: row.pastDueSince } : null;
}
// status alone cannot encode a seven-day grace period. Missing timestamp fails closed.
export function hasAccess(status: string, pastDueSince?: Date | null, now = new Date()): boolean {
  if (status === 'active' || status === 'trialing') return true;
  const age = pastDueSince ? now.getTime() - pastDueSince.getTime() : NaN;
  return status === 'past_due' && age >= 0 && age < 7 * 24 * 60 * 60 * 1000;
}
export class BillingHttpError extends Error {
  constructor(public status: number, message: string, public retryAfter?: number) { super(message); }
}
export async function billingOwner(request: Request) {
  const session = await auth();
  if (!session?.user?.id) throw new BillingHttpError(401, 'Login required');
  if (request.headers.get('origin') !== appUrl()) throw new BillingHttpError(403, 'Invalid origin');
  const retryAfter = billingRateLimit(session.user.id);
  if (retryAfter) throw new BillingHttpError(429, 'Too many billing requests', retryAfter);
  await ensureWorkspace(session.user.id);
  const owned = await getDb().select().from(workspaces).where(eq(workspaces.ownerUserId, session.user.id)).limit(2);
  if (!owned.length) throw new BillingHttpError(404, 'Workspace not found');
  // Request has no workspace selector. Do not silently bill an arbitrary workspace.
  if (owned.length !== 1) throw new BillingHttpError(409, 'Select an active workspace before billing');
  return { workspace: owned[0]!, user: session.user };
}
export function billingError(error: unknown): Response {
  if (error instanceof BillingHttpError) return Response.json({ error: error.message }, { status: error.status, headers: error.retryAfter ? { "Retry-After": String(error.retryAfter) } : undefined });
  // Never log Stripe payloads, Checkout URLs, secrets, or customer information.
  console.error('Stripe billing operation failed');
  return Response.json({ error: 'Billing is temporarily unavailable' }, { status: 500 });
}
