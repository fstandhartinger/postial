'use server';
import { sessionActionBudget } from '@/lib/rate-limit';
import { auth } from '@/auth';
import { acceptInvite, TeamError } from '@/lib/team';
import { setWorkspaceCookie } from '@/lib/workspace-cookie';
import { redirect } from 'next/navigation';
export async function joinAction(token: string, _state: { error?: string }): Promise<{ error?: string }> {
  void _state;
  const session = await auth();
  if (!session?.user?.id) redirect(`/login?next=${encodeURIComponent(`/join/${token}`)}`);
  let id: string;
  try { await sessionActionBudget(session.user.id); id = await acceptInvite(token, session.user.id); }
  catch (e) { return { error: e instanceof TeamError ? e.message : 'Unable to join. Please try again.' }; }
  await setWorkspaceCookie(id);
  redirect('/app');
}
