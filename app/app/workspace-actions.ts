'use server';
import { sessionActionBudget } from '@/lib/rate-limit';
import { coreContext, isUuid } from '@/lib/core';
import { workspaceMembers } from '@/db/schema';
import { and, eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { setWorkspaceCookie } from '@/lib/workspace-cookie';
export async function switchWorkspace(form: FormData) {
  const ctx = await coreContext(), id = String(form.get('workspace'));
  await sessionActionBudget(ctx.userId);
  if (!isUuid(id)) redirect('/app');
  const [member] = await ctx.db.select().from(workspaceMembers).where(and(eq(workspaceMembers.workspaceId, id), eq(workspaceMembers.userId, ctx.userId)));
  if (member) await setWorkspaceCookie(id);
  redirect('/app');
}
