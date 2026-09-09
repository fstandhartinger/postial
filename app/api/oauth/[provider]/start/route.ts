import { auth } from '@/auth';
import { createAuth } from '@/lib/publishers/oauth';
import { appOrigin, isOAuthProvider } from '@/lib/publishers/oauth-config';
export const runtime = 'nodejs';
export const POST = auth(async request => {
  if (!request.auth?.user?.id) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  if (request.headers.get('origin') !== appOrigin()) return Response.json({ error: 'Invalid origin.' }, { status: 403 });
  const provider = new URL(request.url).pathname.split('/')[3];
  if (!isOAuthProvider(provider)) return Response.json({ error: 'Unknown provider.' }, { status: 404 });
  try {
    const data = await request.formData();
    const location = await createAuth(provider, String(data.get('brandId') ?? ''), request.auth.user.id);
    return new Response(null, { status: 303, headers: { Location: location, 'Cache-Control': 'no-store' } });
  } catch { return Response.json({ error: 'Cannot connect this brand. Return to the brand and try again.' }, { status: 400 }); }
});
