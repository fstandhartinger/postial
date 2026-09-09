import type { NextRequest } from 'next/server';
import { auth } from '@/auth';
import { finishAuth } from '@/lib/publishers/oauth';
import { appOrigin, isOAuthProvider } from '@/lib/publishers/oauth-config';
export const runtime = 'nodejs';
const handle = auth(async request => {
  if (!request.auth?.user?.id) return Response.json({ error: 'Sign in and start the connection again.' }, { status: 401 });
  const url = new URL(request.url), provider = url.pathname.split('/')[3];
  if (!isOAuthProvider(provider)) return Response.json({ error: 'Unknown provider.' }, { status: 404 });
  try {
    const brandId = await finishAuth(provider, url.searchParams.get('state') ?? '', url.searchParams.has('error') ? null : url.searchParams.get('code'), request.auth.user.id);
    return new Response(null, { status: 303, headers: { Location: `${appOrigin()}/app/brands/${brandId}?connected=${provider}`, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
  } catch {
    return Response.json({ error: 'Connection failed or expired. Return to the brand and connect again.' }, { status: 400, headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
  }
});

// Lazy Auth.js configuration currently returns a promise for its route wrapper.
export async function GET(request: NextRequest, context: { params: Promise<{ provider: string }> }) {
  return (await handle)(request, context);
}
