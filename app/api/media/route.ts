import { mediaSession } from '@/lib/media/session';
import { uploadMedia } from '@/lib/media/request';
import { apiError } from '@/lib/api/errors';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  try { const {workspace,userId} = await mediaSession(request); return await uploadMedia(request,workspace.id,userId); }
  catch (e) { return apiError(e); }
}
