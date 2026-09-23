'use server';
import { redirect } from 'next/navigation';
import { and, eq, gt } from 'drizzle-orm';
import { getDb } from '@/db';
import { oauthStates } from '@/db/schema';
import { coreContext, isUuid } from '@/lib/core';
import { authorizeBrand, connectOAuthChannel, decryptFacebookPick, logOAuthConnectFailed, type FacebookPick } from '@/lib/publishers/oauth';
import { facebookExpiresIn, tokenCredentials } from '@/lib/publishers/oauth-http';

export async function chooseFacebookPage(formData: FormData) {
  const { userId } = await coreContext();
  const pick = String(formData.get('pick') ?? ''), brandId = String(formData.get('brandId') ?? ''), pageId = String(formData.get('pageId') ?? '');
  if (!/^[A-Za-z0-9_-]{43}$/.test(pick) || !isUuid(brandId)) redirect('/app/brands?connect_error=expired');
  // Single use: the atomic delete binds the pending choice to this session user, brand and expiry.
  const [saved] = await getDb().delete(oauthStates).where(and(eq(oauthStates.state, pick), eq(oauthStates.provider, 'facebook:pick'), eq(oauthStates.userId, userId), eq(oauthStates.brandId, brandId), gt(oauthStates.expiresAt, new Date()))).returning();
  if (!saved) redirect(`/app/brands/${brandId}?connect_error=expired`);
  let page: FacebookPick['pages'][number] | null = null, expiresIn = 0;
  try {
    const pending = decryptFacebookPick(saved.codeVerifier);
    expiresIn = Number(pending.expiresIn);
    page = pending.pages.find(candidate => candidate.id === pageId) ?? null;
    if (!page) throw new Error('Page is not part of this selection');
    await authorizeBrand(brandId, userId);
  } catch { page = null; }
  if (!page) redirect(`/app/brands/${brandId}?connect_error=expired`);
  try {
    await connectOAuthChannel('facebook', tokenCredentials({ access_token: page.accessToken, expires_in: facebookExpiresIn(expiresIn) }), brandId, userId);
  } catch (error) {
    logOAuthConnectFailed('facebook', brandId, error);
    redirect(`/app/brands/${brandId}?connect_error=provider_error`);
  }
  redirect(`/app/brands/${brandId}?connected=facebook`);
}
