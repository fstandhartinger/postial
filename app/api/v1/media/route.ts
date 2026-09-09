import { endpoint } from '@/lib/api/auth';
import { uploadMedia } from '@/lib/media/request';
export const runtime = 'nodejs';
export const POST = endpoint('posts:write', (request,ctx) => uploadMedia(request,ctx.workspace.id,ctx.userId,true));
