import type { NextRequest } from 'next/server';
import { auth } from '@/auth';
import { finishAuth, OAuthCallbackError } from '@/lib/publishers/oauth';
import { appOrigin, isOAuthProvider } from '@/lib/publishers/oauth-config';
export const runtime = 'nodejs';
function back(path: string, code?: string) {
  return new Response(null, {status:303, headers:{Location:`${appOrigin()}${path}${code ? '?connect_error='+code : ''}`, 'Cache-Control':'no-store', 'Referrer-Policy':'no-referrer'}});
}
const handle = auth(async request => {
  if (!request.auth?.user?.id) return back('/app/brands', 'expired');
  const url = new URL(request.url), provider = url.pathname.split('/')[3];
  if (!isOAuthProvider(provider)) return back('/app/brands', 'provider_error');
  try {
    const brandId = await finishAuth(provider, url.searchParams.get('state') ?? '', url.searchParams.has('error') ? null : url.searchParams.get('code'), request.auth.user.id);
    return new Response(null, { status: 303, headers: { Location: `${appOrigin()}/app/brands/${brandId}?connected=${provider}`, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
  } catch (error) {
    const e = error instanceof OAuthCallbackError ? error : new OAuthCallbackError('provider_error');
    return back(e.brandId ? `/app/brands/${e.brandId}` : '/app/brands', e.code);
  }
});

// Lazy Auth.js configuration currently returns a promise for its route wrapper.
export async function GET(request: NextRequest, context: { params: Promise<{ provider: string }> }) {
  return (await handle)(request, context);
}
