import Link from 'next/link';
import { and, eq, gt, isNull, count } from 'drizzle-orm';
import { coreContext } from '@/lib/core';
import { workspaceEntitlements } from '@/lib/entitlements';
import { users, workspaceMembers, workspaceInvites, apiKeys } from '@/db/schema';
import { TeamForm } from '@/components/team/team-form';
export default async function TeamPage() {
  const { db, workspace, userId, role } = await coreContext();
  if (role !== 'owner') return <p>Only owners can manage the team.</p>;
  const members = await db.select({ member: workspaceMembers, name: users.name, email: users.email }).from(workspaceMembers).innerJoin(users, eq(users.id, workspaceMembers.userId)).where(eq(workspaceMembers.workspaceId, workspace.id));
  const keyCounts = await db.select({userId:apiKeys.createdByUserId, count:count()}).from(apiKeys).where(and(eq(apiKeys.workspaceId,workspace.id), isNull(apiKeys.revokedAt))).groupBy(apiKeys.createdByUserId);
  const invites = await db.select({ id: workspaceInvites.id, role: workspaceInvites.role, expiresAt: workspaceInvites.expiresAt }).from(workspaceInvites).where(and(eq(workspaceInvites.workspaceId, workspace.id), isNull(workspaceInvites.acceptedAt), isNull(workspaceInvites.revokedAt), gt(workspaceInvites.expiresAt, new Date())));
  const { seats } = await workspaceEntitlements(workspace);
  return <div className="mx-auto max-w-4xl space-y-6"><h1 className="text-3xl font-bold">Team</h1><p><Link href="/app/settings/notifications">Notifications</Link> · <Link href="/app/settings/legal">Legal &amp; DPA</Link></p><p>{workspace.name} · {members.length} of {seats} seats used</p><p>Owners manage billing, API settings and the team. Editors manage brands, posts and channels.</p><Link className="underline" href="/app/settings/api">API settings</Link>
    <section className="space-y-4"><h2 className="text-xl font-semibold">Members</h2>{members.map(({ member, name, email }) => <article key={member.userId} className="space-y-3 rounded-xl border p-4"><h3 className="break-all font-semibold">{name || email || 'Member'}{member.userId === userId ? ' (you)' : ''}</h3><p className="break-all">{email}</p><p>{member.role} · Joined {member.joinedAt.toLocaleDateString('en-GB', { timeZone: 'UTC' })}</p><TeamForm action="role" target={member.userId} role={member.role}/>{member.userId !== userId && <div><p>This member created {keyCounts.find(k => k.userId === member.userId)?.count ?? 0} API keys — review them. Removing the member leaves workspace keys and webhooks active.</p><TeamForm action="remove" target={member.userId}/></div>}</article>)}</section>
    <section className="space-y-4"><h2 className="text-xl font-semibold">Invite members</h2>{members.length >= seats && <p>Seat limit reached. <Link className="underline" href="/app/billing">Upgrade your plan</Link> to invite more members.</p>}<TeamForm action="create" disabled={members.length >= seats}/><h3 className="font-semibold">Open invitations</h3>{!invites.length && <p>No open invitations.</p>}{invites.map(invite => <article key={invite.id} className="space-y-3 rounded-xl border p-4"><p>{invite.role} · Expires {invite.expiresAt.toLocaleDateString('en-GB', { timeZone: 'UTC' })}</p><TeamForm action="revoke" target={invite.id}/></article>)}</section></div>;
}
