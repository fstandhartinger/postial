import { auth } from '@/auth';
import { ensureWorkspace } from '@/lib/workspaces';
import { NextRequest, NextResponse } from 'next/server';
import { anonymousLimit } from '@/lib/rate-limit';
import { actionBodyLimit } from '@/lib/http/action-limit';
import { readBody } from '@/lib/http/body';
import { apiError } from '@/lib/api/errors';

const defaultRedirectHosts = ['www.postial.co', 'postial.net', 'www.postial.net'];

function configuredRedirectHosts(): Set<string> {
  return new Set(
    (process.env.REDIRECT_HOSTS?.split(',') ?? defaultRedirectHosts)
      .map(host => host.trim().toLowerCase())
      .filter(Boolean),
  );
}

function requestHost(request: NextRequest): string {
  return request.headers.get('host')?.split(':')[0].trim().toLowerCase() ?? '';
}

function canonicalOrigin(): string {
  return new URL(process.env.NEXT_PUBLIC_APP_URL ?? 'https://postial.co').origin;
}

function redirectToCanonical(request: NextRequest, origin: string): NextResponse {
  const location = `${origin}${request.nextUrl.pathname}${request.nextUrl.search}`;
  return NextResponse.redirect(location, { status: 301, headers: { 'Cache-Control': 'max-age=300' } });
}

/** Applies before RSC/Server Action parsing, including non-FormData action arguments. */
export async function proxy(request: NextRequest) {
  try {
    if (request.nextUrl.pathname !== '/healthz') {
      const host = requestHost(request);
      const origin = canonicalOrigin();
      const canonicalHost = new URL(origin).hostname.toLowerCase();
      if (configuredRedirectHosts().has(host) || (process.env.LEGACY_HOST_REDIRECT === '1' && host === 'socialmint.app.mintapis.com')) {
        if (host !== canonicalHost) return redirectToCanonical(request, origin);
      }
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
