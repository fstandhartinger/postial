import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { users, workspaces, workspaceMembers, subscriptions } from "@/db/schema";
import { TRIAL_DAYS } from "./plans";
export async function ensureWorkspace(userId: string) {
  return getDb().transaction(async tx => {
    // Serialize onboarding for this user, including simultaneous first requests.
    await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for("update");
    const [existing] = await tx.select({ workspace: workspaces }).from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
      .where(eq(workspaceMembers.userId, userId)).limit(1);
    if (existing) return existing.workspace;
    const [workspace] = await tx.insert(workspaces).values({ name: "My workspace", slug: `workspace-${crypto.randomUUID()}`, ownerUserId: userId }).returning();
    await tx.insert(workspaceMembers).values({ workspaceId: workspace.id, userId, role: "owner" });
    await tx.insert(subscriptions).values({ workspaceId: workspace.id, trialEnd: new Date(Date.now() + TRIAL_DAYS * 86400000) });
    return workspace;
  });
}
