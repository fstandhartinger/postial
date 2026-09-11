import { classifyUserAgent, recordFunnelEvent } from '@/lib/funnel';
export const runtime = 'nodejs';

/**
 * Marks that a real browser engine rendered the landing page. Server-side view counts
 * cannot tell a person from a crawler that sends a browser user agent; only executing
 * JavaScript does. Nothing about the visitor is stored beyond the same coarse class the
 * page view already carries.
 */
export async function POST(request: Request) {
  await recordFunnelEvent('client_ready', {
    path: '/',
    clientClass: classifyUserAgent(request.headers.get('user-agent')),
  });
  return new Response(null, { status: 204 });
}
