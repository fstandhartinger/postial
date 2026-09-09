import type { NextRequest } from 'next/server';
import { auth } from '@/auth';
import { createAuth } from '@/lib/publishers/oauth';
import { appOrigin, isOAuthProvider } from '@/lib/publishers/oauth-config';
export const runtime = 'nodejs';
const handle = auth(async request => {
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

// Lazy Auth.js configuration currently returns a promise for its route wrapper.
export async function POST(request: NextRequest, context: { params: Promise<{ provider: string }> }) {
  return (await handle)(request, context);
}
