import { cookies } from "next/headers";
import { requireLogin } from './require-login';
import { workspaceEntitlements } from './entitlements';
import { auth } from "@/auth";
import { notFound } from "next/navigation";
import { ensureWorkspace } from "@/lib/workspaces";
import { getDb } from "@/db";
import { brands, channels, posts, workspaceMembers } from "@/db/schema";
import { and, eq } from "drizzle-orm";
export async function coreContext() {
  const session = await auth();
  if (!session?.user?.id) return requireLogin();
  const workspace = await ensureWorkspace(session.user.id, (await cookies()).get("sm_ws")?.value);
  const [member] = await getDb().select().from(workspaceMembers).where(and(eq(workspaceMembers.workspaceId, workspace.id), eq(workspaceMembers.userId, session.user.id)));
  if (!member) return requireLogin();
  return {
    role: member.role,
    userId: session.user.id,
    workspace,
    db: getDb(),
  };
}
export async function ownBrand(id: string) {
  const ctx = await coreContext();
  if (!isUuid(id)) notFound();
  const [brand] = await ctx.db
    .select()
    .from(brands)
    .where(and(eq(brands.id, id), eq(brands.workspaceId, ctx.workspace.id)));
  if (!brand) notFound();
  return { ...ctx, brand };
}
export async function ownPost(id: string) {
  const ctx = await coreContext();
  if (!isUuid(id)) notFound();
  const [row] = await ctx.db
    .select({ post: posts, brand: brands })
    .from(posts)
    .innerJoin(brands, eq(brands.id, posts.brandId))
    .where(and(eq(posts.id, id), eq(brands.workspaceId, ctx.workspace.id)));
  if (!row) notFound();
  return { ...ctx, ...row };
}
export function isUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    s,
  );
}
export async function composerData() {
  const ctx = await coreContext();
  const bs = await ctx.db
    .select()
    .from(brands)
    .where(eq(brands.workspaceId, ctx.workspace.id));
  const cs = await ctx.db
    .select({
      id: channels.id,
      brandId: channels.brandId,
      provider: channels.provider,
      meta: channels.meta,
      displayName: channels.displayName,
    })
    .from(channels)
    .innerJoin(brands, eq(brands.id, channels.brandId))
    .where(
      and(
        eq(brands.workspaceId, ctx.workspace.id),
        eq(channels.status, "active"),
      ),
    );
  const access = await workspaceEntitlements(ctx.workspace);
  return { brands: bs.map(b => ({ ...b, readOnly: !access.activeBrandIds.includes(b.id) })), channels: cs, canPublish: access.publish, approvalLinks: access.approvalLinks };
}
