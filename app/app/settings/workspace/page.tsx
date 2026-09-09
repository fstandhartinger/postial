import Link from 'next/link';
import { and,eq,ne } from 'drizzle-orm';
import { coreContext } from '@/lib/core';
import { users,workspaceMembers } from '@/db/schema';
import { SettingsForm } from '@/components/settings/destructive-form';
import { workspaceAction } from './actions';
export default async function WorkspaceSettings() {
  const ctx = await coreContext();
  if(ctx.role!=='owner') return <p>Only owners can manage workspace data. <Link href="/app/settings/account">Account settings</Link></p>;
  const members = await ctx.db.select({id:users.id,name:users.name,email:users.email}).from(workspaceMembers).innerJoin(users,eq(users.id,workspaceMembers.userId)).where(and(eq(workspaceMembers.workspaceId,ctx.workspace.id),ne(workspaceMembers.userId,ctx.userId)));
  return <><h1 className="text-3xl font-bold">Workspace settings</h1><p>{ctx.workspace.name}</p>
    <a href="/app/settings/workspace/export" download className="inline-block rounded border p-3">Export data</a>
    <h2 className="text-xl font-semibold">Transfer ownership</h2><p>The selected member becomes an owner. You become an editor.</p>
    <SettingsForm action={workspaceAction} label="Transfer ownership" operation="transfer" members={members.map(m=>({id:m.id,name:m.name||m.email||m.id}))}/>
    <h2 className="text-xl font-semibold">Delete workspace</h2><p>This cancels the subscription immediately without proration, expires open checkouts and permanently deletes the workspace, brands, channels, posts, media, keys, webhooks and invitations. Export first. Published posts on other networks remain.</p>
    <SettingsForm action={workspaceAction} label="Delete workspace" operation="delete" confirmation={ctx.workspace.name}/>
    <Link href="/app/settings/account">Account settings</Link></>;
}
