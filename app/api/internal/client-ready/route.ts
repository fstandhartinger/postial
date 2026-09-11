import { classifyUserAgent, recordFunnelEvent } from '@/lib/funnel';
export const runtime = 'nodejs';

// Only the shapes we serve ourselves. The body reaches us from the browser, so an
// arbitrary string must never end up in the funnel as if it were one of our pages.
const publicPath = /^\/(?:$|docs(?:\/[a-z0-9-]{1,64})?$|compare(?:\/[a-z0-9-]{1,64})?$|pricing$)/;

/**
 * Marks that a real browser engine rendered a public page. Server-side view counts cannot
 * tell a person from a crawler that sends a browser user agent; only executing JavaScript
 * does. Nothing about the visitor is stored beyond the coarse class the page view carries.
 */
export async function POST(request: Request) {
  let path: string | undefined;
  try {
    const body: unknown = await request.json();
    const candidate = typeof body === 'object' && body !== null ? (body as { path?: unknown }).path : undefined;
    if (typeof candidate === 'string' && publicPath.test(candidate)) path = candidate;
  } catch { /* a missing or broken body simply means we record no path */ }
  await recordFunnelEvent('client_ready', {
    path,
    clientClass: classifyUserAgent(request.headers.get('user-agent')),
  });
  return new Response(null, { status: 204 });
}
