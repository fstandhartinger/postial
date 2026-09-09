import { NextRequest, NextResponse } from 'next/server';
export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  // Overwrite untrusted client headers with the actual path and query.
  headers.set('x-socialmint-path', request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.next({ request: { headers } });
}
export const config = { matcher: ['/app/:path*'] };
