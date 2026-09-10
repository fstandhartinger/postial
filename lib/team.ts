import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt } from 'drizzle-orm';
import { getDb } from '@/db';
import { users, workspaces, workspaceMembers, workspaceInvites } from '@/db/schema';
import { workspaceEntitlements } from '@/lib/entitlements';
import { normalizeEmail } from '@/lib/auth-email';
export class TeamError extends Error {}
export const hashInvite = (token: string) => createHash('sha256').update(token).digest('hex');
export function inviteProblem(invite: typeof workspaceInvites.$inferSelect | undefined) {
  if (!invite) return 'Invitation not found.';
  if (invite.revokedAt) return 'This invitation was revoked.';
  if (invite.acceptedAt) return 'This invitation has already been used.';
  if (invite.expiresAt <= new Date()) return 'This invitation has expired.';
  return null;
}
export async function findInvite(token: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return undefined;
  const [row] = await getDb().select({ invite: workspaceInvites, workspace: workspaces, inviter: users.name })
    .from(workspaceInvites).innerJoin(workspaces, eq(workspaces.id, workspaceInvites.workspaceId))
    .leftJoin(users, eq(users.id, workspaceInvites.createdBy)).where(eq(workspaceInvites.tokenHash, hashInvite(token)));
  return row;
}
export async function manageTeam(workspaceId: string, actor: string, action: string, target = '', role = 'editor', invitedEmail = '') {
  return getDb().transaction(async tx => {
    const [ws] = await tx.select().from(workspaces).where(eq(workspaces.id, workspaceId)).for('update');
    if (!ws) throw new TeamError('Workspace not found.');
    const members = await tx.select().from(workspaceMembers).where(eq(workspaceMembers.workspaceId, workspaceId));
    if (!members.some(m => m.userId === actor && m.role === 'owner')) throw new TeamError('Only owners can manage the team.');
    if (action === 'create') {
      if (role !== 'owner' && role !== 'editor') throw new TeamError('Invalid role.');
      let email: string;
      try { email = normalizeEmail(invitedEmail); } catch { throw new TeamError('Enter a valid email address.'); }
      const access = await workspaceEntitlements(workspaceId);
      if (members.length >= access.seats) throw new TeamError('Seat limit reached. Upgrade to Agency to invite more members.');
      const recent = await tx.select({ id: workspaceInvites.id }).from(workspaceInvites).where(and(eq(workspaceInvites.workspaceId, workspaceId), gt(workspaceInvites.createdAt, new Date(Date.now() - 3600000))));
      if (recent.length >= 10) throw new TeamError('Invite limit reached. Try again in an hour.');
      const token = randomBytes(32).toString('base64url');
      await tx.insert(workspaceInvites).values({ workspaceId, role, invitedEmail: email, tokenHash: hashInvite(token), createdBy: actor, expiresAt: new Date(Date.now() + 7 * 86400000) });
      return token;
    }
    if (action === 'revoke') {
      if (!/^[0-9a-f-]{36}$/i.test(target)) throw new TeamError('Invalid invitation.');
      await tx.update(workspaceInvites).set({ revokedAt: new Date() }).where(and(eq(workspaceInvites.workspaceId, workspaceId), eq(workspaceInvites.id, target)));
      return;
    }
    const member = members.find(m => m.userId === target);
    if (!member) throw new TeamError('Member not found.');
    if (action !== 'remove' && action !== 'role') throw new TeamError('Invalid action.');
    if (action === 'remove' && target === actor) throw new TeamError('You cannot remove yourself.');
    if (role !== 'owner' && role !== 'editor') throw new TeamError('Invalid role.');
    if (member.role === 'owner' && (action === 'remove' || role !== 'owner') && members.filter(m => m.role === 'owner').length <= 1) throw new TeamError('At least one owner must remain.');
    // Keep the legacy creator reference attached to a current owner.
    if (ws.ownerUserId === target && (action === 'remove' || role !== 'owner')) {
      const replacement = members.find(m => m.role === 'owner' && m.userId !== target)!;
      await tx.update(workspaces).set({ ownerUserId: replacement.userId }).where(eq(workspaces.id, workspaceId));
    }
    const condition = and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, target));
    if (action === 'remove') await tx.delete(workspaceMembers).where(condition);
    else await tx.update(workspaceMembers).set({ role: role as 'owner' | 'editor' }).where(condition);
  });
}
export async function acceptInvite(token: string, userId: string) {
  const found = await findInvite(token);
  if (!found) throw new TeamError('Invitation not found.');
  return getDb().transaction(async tx => {
    // Same user lock as onboarding; same workspace lock as team mutations.
    await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('update');
    await tx.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.id, found.workspace.id)).for('update');
    const [invite] = await tx.select().from(workspaceInvites).where(eq(workspaceInvites.id, found.invite.id));
    const problem = inviteProblem(invite);
    if (problem) throw new TeamError(problem);
    const [user] = await tx.select({ email: users.email }).from(users).where(eq(users.id, userId));
    let userEmail: string;
    try { userEmail = normalizeEmail(user?.email || ''); } catch { throw new TeamError('This invitation was sent to a different email address.'); }
    if (userEmail !== invite.invitedEmail) throw new TeamError('This invitation was sent to a different email address.');
    const members = await tx.select().from(workspaceMembers).where(eq(workspaceMembers.workspaceId, invite.workspaceId));
    if (members.some(m => m.userId === userId)) throw new TeamError('You are already a member of this workspace.');
    if (members.length >= (await workspaceEntitlements(invite.workspaceId)).seats) throw new TeamError('This workspace has reached its seat limit. Ask an owner to upgrade.');
    await tx.insert(workspaceMembers).values({ workspaceId: invite.workspaceId, userId, role: invite.role });
    await tx.update(workspaceInvites).set({ acceptedBy: userId, acceptedAt: new Date() }).where(eq(workspaceInvites.id, invite.id));
    return invite.workspaceId;
  });
}
