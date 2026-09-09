import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { ensureWorkspace } from '@/lib/workspaces';
export async function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  // Overwrite untrusted client headers with the actual path and query.
  headers.set('x-socialmint-path', request.nextUrl.pathname + request.nextUrl.search);
  // Response cookies must be cleared before Server Components begin streaming.
  const active = request.cookies.get('sm_ws')?.value;
  let clear = false;
  if (active) {
    const session = await auth();
    clear = !session?.user?.id || (await ensureWorkspace(session.user.id, active)).id !== active;
    if (clear) { request.cookies.delete('sm_ws'); headers.set('cookie', request.cookies.toString()); }
  }
  const response = NextResponse.next({ request: { headers } });
  if (clear) response.cookies.delete('sm_ws');
  return response;
}
export const config = { matcher: ['/app/:path*', '/api/media/:path*', '/api/stripe/checkout', '/api/stripe/portal'] };
