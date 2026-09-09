import { auth } from '@/auth';
import { finishAuth } from '@/lib/publishers/oauth';
import { appOrigin, isOAuthProvider } from '@/lib/publishers/oauth-config';
export const runtime = 'nodejs';
export const GET = auth(async request => {
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
