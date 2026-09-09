import { sessionActionBudget } from '@/lib/rate-limit';
import { mediaSession } from '@/lib/media/session';
import { deleteMedia } from '@/lib/media/service';
import { apiError } from '@/lib/api/errors';
export async function DELETE(request: Request, {params}: {params: Promise<{id:string}>}) {
  try { const {workspace,userId} = await mediaSession(request); await sessionActionBudget(userId); await deleteMedia(workspace.id,(await params).id); return new Response(null,{status:204}); }
  catch (e) { return apiError(e, '/api/media/[id]'); }
}
