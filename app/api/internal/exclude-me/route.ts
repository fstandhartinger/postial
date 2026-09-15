import { timingSafeEqual } from 'node:crypto';
import { internalMarkerValue } from '@/lib/funnel';

export const runtime = 'nodejs';

const sharedHeaders = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
} as const;

function safeEqual(left: string, right: string): boolean {
  if (Buffer.byteLength(left) !== Buffer.byteLength(right)) return false;
  return timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

function notFound() {
  return new Response('Not found', {
    status: 404,
    headers: { ...sharedHeaders, 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (url.searchParams.get('off') === '1') {
    return new Response('This browser is now included in Postial visitor statistics.', {
      status: 200,
      headers: {
        ...sharedHeaders,
        'Content-Type': 'text/plain; charset=utf-8',
        'Set-Cookie': 'pm_internal=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax',
      },
    });
  }

  const token = process.env.FUNNEL_INTERNAL_TOKEN;
  const marker = internalMarkerValue();
  const candidate = url.searchParams.get('token');
  if (!token || !marker || !candidate || !safeEqual(candidate, token)) return notFound();

  return new Response('This browser is now excluded from Postial visitor statistics.', {
    status: 200,
    headers: {
      ...sharedHeaders,
      'Content-Type': 'text/plain; charset=utf-8',
      'Set-Cookie': `pm_internal=${marker}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax`,
    },
  });
}
