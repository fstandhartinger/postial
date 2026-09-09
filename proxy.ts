import { auth } from '@/auth';
import { ensureWorkspace } from '@/lib/workspaces';
import { NextRequest, NextResponse } from 'next/server';
import { anonymousLimit } from '@/lib/rate-limit';
import { actionBodyLimit } from '@/lib/http/action-limit';
import { readBody } from '@/lib/http/body';
import { apiError } from '@/lib/api/errors';
/** Applies before RSC/Server Action parsing, including non-FormData action arguments. */
export async function proxy(request: NextRequest) {
  try {
    if (process.env.LEGACY_HOST_REDIRECT === '1' && request.headers.get('host')?.split(':')[0] === 'socialmint.app.mintapis.com' && request.nextUrl.pathname !== '/healthz') {
      return NextResponse.redirect(`https://postial.co${request.nextUrl.pathname}${request.nextUrl.search}`, 301);
    }
    if (request.nextUrl.pathname.startsWith('/join/')) {
      const limited = await anonymousLimit(request.headers, 'join', 30);
      if (limited) return limited;
    }
    if (request.method === 'POST' && !request.nextUrl.pathname.startsWith('/api/media')) {
      await readBody(request.clone(), await actionBodyLimit(request));
    }
    const headers = new Headers(request.headers);
    headers.set('x-postial-path',request.nextUrl.pathname+request.nextUrl.search);
    const active = request.cookies.get('sm_ws')?.value;
    let clear = false;
    if(active) {
      const session = await auth();
      clear = !session?.user?.id || (await ensureWorkspace(session.user.id,active)).id !== active;
      if(clear) {request.cookies.delete('sm_ws');headers.set('cookie',request.cookies.toString());}
    }
    const response = NextResponse.next({request:{headers}});
    if(clear) response.cookies.delete('sm_ws');
    return response;
  } catch (e) { return apiError(e); }
}
export const config = {matcher:['/:path*']};
