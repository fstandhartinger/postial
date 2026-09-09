import { asc, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { brands } from '@/db/schema';
import { getSubscriptionForWorkspace, hasAccess } from '@/lib/billing';
import { plans } from '@/lib/plans';
export async function workspaceEntitlements(workspace: { id: string } | string) {
  const id = typeof workspace === 'string' ? workspace : workspace.id;
  const sub = await getSubscriptionForWorkspace(id);
  const publish = !!sub?.stripeSubscriptionId && hasAccess(sub.status, sub.pastDueSince);
  const limit = publish ? plans[sub!.plan].brands : plans.starter.brands;
  const list = await getDb().select({ id: brands.id }).from(brands).where(eq(brands.workspaceId, id)).orderBy(asc(brands.createdAt), asc(brands.id));
  return { publish, limit, activeBrandIds: list.slice(0, limit).map(b => b.id) };
}
export async function canPublish(workspace: { id: string } | string) { return (await workspaceEntitlements(workspace)).publish; }
export async function canEditBrand(workspace: { id: string } | string, brandId: string) { return (await workspaceEntitlements(workspace)).activeBrandIds.includes(brandId); }
