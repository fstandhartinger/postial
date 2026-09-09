import Link from 'next/link';
import { auth } from '@/auth';
import { findInvite, inviteProblem } from '@/lib/team';
import { getDb } from '@/db';
import { workspaceMembers } from '@/db/schema';
import { and, eq } from 'drizzle-orm';
import { JoinForm } from '@/components/team/join-form';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Join workspace', robots: { index: false, follow: false }, referrer: 'no-referrer' as const };
export default async function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params, found = await findInvite(token);
  const problem = inviteProblem(found?.invite);
  if (problem || !found) return <div className="mx-auto max-w-lg p-6"><h1 className="text-3xl font-bold">Workspace invitation</h1><p className="mt-4">{problem}</p></div>;
  const session = await auth();
  const members = session?.user?.id ? await getDb().select().from(workspaceMembers).where(and(eq(workspaceMembers.workspaceId, found.workspace.id), eq(workspaceMembers.userId, session.user.id))) : [];
  return <div className="mx-auto my-12 max-w-lg space-y-6 rounded-xl border p-6"><h1 className="text-3xl font-bold">Join {found.workspace.name}</h1><p>{found.inviter || 'A workspace owner'} invited you to join as {found.invite.role}.</p>{members.length ? <p>You are already a member of this workspace.</p> : session?.user?.id ? <JoinForm token={token}/> : <Link className="font-semibold text-emerald-700 underline" href={`/login?next=${encodeURIComponent(`/join/${token}`)}`}>Sign in to join</Link>}</div>;
}
