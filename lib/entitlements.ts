import { asc, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { brands } from '@/db/schema';
import { getSubscriptionForWorkspace } from '@/lib/billing';
import { plans } from '@/lib/plans';
type SubscriptionAccess = { stripeSubscriptionId: string | null; status: string; trialEnd: Date | null; currentPeriodEnd: Date | null; pastDueSince?: Date | null };
/** Fail closed on missing dates; paid renewals have three days to reconcile. */
export function hasAccess(sub: SubscriptionAccess | null | undefined, now = new Date()): boolean {
  if (!sub?.stripeSubscriptionId || !['trialing', 'active', 'past_due'].includes(sub.status)) return false;
  if (sub.status === 'trialing') return !!sub.trialEnd && sub.trialEnd.getTime() > now.getTime();
  if (!sub.currentPeriodEnd || sub.currentPeriodEnd.getTime() + 3 * 86400000 <= now.getTime()) return false;
  if (sub.status === 'past_due') {
    const age = sub.pastDueSince ? now.getTime() - sub.pastDueSince.getTime() : NaN;
    return age >= 0 && age < 7 * 86400000;
  }
  return true;
}
export async function workspaceEntitlements(workspace: { id: string } | string) {
  const id = typeof workspace === 'string' ? workspace : workspace.id;
  const sub = await getSubscriptionForWorkspace(id);
  const publish = hasAccess(sub);
  const limit = publish ? plans[sub!.plan].brands : plans.starter.brands;
  const list = await getDb().select({ id: brands.id }).from(brands).where(eq(brands.workspaceId, id)).orderBy(asc(brands.createdAt), asc(brands.id));
  return { mediaBytes: (publish ? plans[sub!.plan] : plans.starter).mediaBytes, publish, approvalLinks: publish && plans[sub!.plan].approvalLinks, api: publish && sub!.plan === "agency", limit, activeBrandIds: list.slice(0, limit).map(b => b.id) };
}
export async function canPublish(workspace: { id: string } | string) { return (await workspaceEntitlements(workspace)).publish; }
export async function canEditBrand(workspace: { id: string } | string, brandId: string) { return (await workspaceEntitlements(workspace)).activeBrandIds.includes(brandId); }
