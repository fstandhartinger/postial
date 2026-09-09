'use server';
import { cookies } from 'next/headers';
import { coreContext } from '@/lib/core';
import { sessionActionBudget } from '@/lib/rate-limit';
import { deleteWorkspace, transferOwnership } from '@/lib/offboarding';
import { ApiError } from '@/lib/api/errors';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
export async function workspaceAction(_state:{error:string},form:FormData) {
  const ctx = await coreContext();
  const action = String(form.get('action'));
  try {
    await sessionActionBudget(ctx.userId);
    if (action === 'delete') await deleteWorkspace(ctx.workspace.id,ctx.userId,String(form.get('confirmation')));
    else if (action === 'transfer') await transferOwnership(ctx.workspace.id,ctx.userId,String(form.get('target')));
    else throw new ApiError(422,'validation_error','Unknown action.');
  } catch(e) { return {error:e instanceof ApiError?e.message:'Could not finish. Deletion may be paused; retry to finish billing cancellation and cleanup.'}; }
  if(action==='delete') (await cookies()).delete('sm_ws');
  revalidatePath('/app','layout');
  redirect(action==='delete'?'/app/settings/account':'/app/settings/workspace');
}
