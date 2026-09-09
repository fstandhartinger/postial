import { isUuid } from '@/lib/api/input';
import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { users, workspaces, workspaceMembers } from "@/db/schema";
export async function ensureWorkspace(userId: string, activeId?: string) {
  return getDb().transaction(async tx => {
    // Serialize onboarding for this user, including simultaneous first requests.
    await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for("update");
    if (activeId && isUuid(activeId)) {
      const [active] = await tx.select({ workspace: workspaces }).from(workspaceMembers)
        .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
        .where(and(eq(workspaceMembers.userId, userId), eq(workspaces.id, activeId)));
      if (active) return active.workspace;
    }
    const [existing] = await tx.select({ workspace: workspaces }).from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
      .where(eq(workspaceMembers.userId, userId)).orderBy(asc(workspaces.createdAt), asc(workspaces.id)).limit(1);
    if (existing) return existing.workspace;
    const [workspace] = await tx.insert(workspaces).values({ name: "My workspace", slug: `workspace-${crypto.randomUUID()}`, ownerUserId: userId }).returning();
    await tx.insert(workspaceMembers).values({ workspaceId: workspace.id, userId, role: "owner" });
    return workspace;
  });
}
