'use server';
import { auth } from '@/auth';
import { deleteAccount } from '@/lib/offboarding';
import { sessionActionBudget } from '@/lib/rate-limit';
import { ApiError } from '@/lib/api/errors';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
export async function accountAction(_state:{error:string},form:FormData) {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  try { await sessionActionBudget(session.user.id); await deleteAccount(session.user.id,String(form.get('confirmation'))); }
  catch(e) { return {error:e instanceof ApiError?e.message:'Could not delete your account. Please try again.'}; }
  const jar = await cookies();
  for (const name of ['sm_ws','authjs.session-token','__Secure-authjs.session-token']) jar.delete(name);
  redirect('/login?deleted=1');
}
