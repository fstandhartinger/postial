import { classifyUserAgent, recordFunnelEvent, referrerHost } from '@/lib/funnel';
export const runtime = 'nodejs';

// Only the shapes we serve ourselves. The body reaches us from the browser, so an
// arbitrary string must never end up in the funnel as if it were one of our pages.
const publicPath = /^\/(?:$|docs(?:\/[a-z0-9-]{1,64})?$|compare(?:\/[a-z0-9-]{1,64})?$|pricing$)/;
const publicViewEvent = (path: string | undefined) =>
  path === '/' ? 'landing_view' : path === '/pricing' ? 'pricing_view' :
  path?.startsWith('/compare') ? 'compare_view' : path?.startsWith('/docs') ? 'docs_view' : undefined;

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
  const options = {
    path,
    referrerHost: referrerHost(request.headers.get('referer')),
    clientClass: classifyUserAgent(request.headers.get('user-agent')),
  } as const;
  // Public HTML is cacheable, so the browser beacon is now the page-view write. It
  // preserves the event/path/class distinction without making HTML rendering open a DB
  // transaction. Automated fetches are intentionally absent from these page-view events;
  // this is a documented accuracy trade-off of caching, while the class remains explicit.
  // Finish the beacon response before starting database work. This keeps the
  // measurement off the render path and prevents a client-ready request from
  // holding a browser's network-idle boundary open while the best-effort write
  // waits for a pool connection.
  const event = publicViewEvent(path) ?? 'client_ready';
  setTimeout(() => { void recordFunnelEvent(event, options); }, 0);
  return new Response(null, { status: 204 });
}
