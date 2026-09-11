import { visibleIdentifier, linkInput } from '@/lib/text-input';
import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, lt } from 'drizzle-orm';
import { getDb } from '@/db';
import { brands, channels, oauthStates, workspaceMembers } from '@/db/schema';
import { encryptCredentials, decryptCredentials } from '@/lib/crypto';
import { canEditBrand } from '@/lib/entitlements';
import { ownBrand, isUuid } from '@/lib/core';
import { getPublisher } from './index';
import { failure } from './http';
import { callbackUrl, FACEBOOK_GRAPH_VERSION, oauthConfig, type OAuthProvider } from './oauth-config';
import { facebookPageToken, facebookToken, oauthJson, tokenCredentials, xToken, linkedinToken, type TokenResponse } from './oauth-http';
import { recordFunnelEvent } from '@/lib/funnel';
import { clearChannelAlertLocks } from '@/lib/alert-mail';

async function authorizeBrand(brandId: string, userId: string) {
  if (!isUuid(brandId)) throw failure('AUTH_EXPIRED', 'Brand not found.');
  const [row] = await getDb().select({ brand: brands, role: workspaceMembers.role }).from(brands)
    .innerJoin(workspaceMembers, eq(workspaceMembers.workspaceId, brands.workspaceId))
    .where(and(eq(brands.id, brandId), eq(workspaceMembers.userId, userId)));
  if (!row || !await canEditBrand(row.brand.workspaceId, brandId)) throw failure('AUTH_EXPIRED', 'You cannot connect channels for this brand.');
  return row.brand.workspaceId;
}
/** Server action entry point; identity always comes from the current session. */
export async function startAuth(provider: OAuthProvider, brandId: string) {
  const { userId } = await ownBrand(brandId);
  return createAuth(provider, brandId, userId);
}
/** Route/service entry point. Callers must supply the authenticated session user. */
export async function createAuth(provider: OAuthProvider, brandId: string, userId: string) {
  await authorizeBrand(brandId, userId);
  const config = oauthConfig(provider);
  if (!config) throw failure('AUTH_EXPIRED', 'This connection is coming soon: the app credentials are not configured.');
  const state = randomBytes(32).toString('base64url'), verifier = randomBytes(32).toString('base64url');
  const db = getDb();
  await db.delete(oauthStates).where(lt(oauthStates.expiresAt, new Date()));
  await db.insert(oauthStates).values({ state, codeVerifier: encryptCredentials({ verifier }), brandId, userId, provider, expiresAt: new Date(Date.now() + 600000) });
  const url = new URL(provider === 'x' ? 'https://x.com/i/oauth2/authorize' : provider === 'threads' ? 'https://www.threads.com/oauth/authorize' : provider === 'facebook' ? `https://www.facebook.com/${FACEBOOK_GRAPH_VERSION}/dialog/oauth` : 'https://www.linkedin.com/oauth/v2/authorization');
  url.search = new URLSearchParams({ client_id: config.id, redirect_uri: callbackUrl(provider), response_type: 'code', state,
    scope: provider === 'x' ? 'tweet.read tweet.write users.read offline.access media.write' : provider === 'threads' ? 'threads_basic,threads_content_publish' : provider === 'facebook' ? 'pages_show_list,pages_read_engagement,pages_manage_posts' : 'openid profile email w_member_social',
    // Threads does not document PKCE support. Its confidential code exchange uses app_secret.
    ...(provider === 'x' ? { code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' } : {}),
  }).toString();
  return url.href;
}
export class OAuthCallbackError extends Error {
  constructor(public code: 'denied' | 'expired' | 'provider_error', public brandId?: string) { super(code); }
}
export async function finishAuth(provider: OAuthProvider, state: string, code: string | null, userId: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(state)) throw new OAuthCallbackError('expired');
  const db = getDb();
  // Atomic consumption commits BEFORE the provider call, including denied or failed exchanges.
  const [saved] = await db.delete(oauthStates).where(and(eq(oauthStates.state, state), eq(oauthStates.provider, provider), eq(oauthStates.userId, userId), gt(oauthStates.expiresAt, new Date()))).returning();
  if (!saved) throw new OAuthCallbackError('expired');
  let workspaceId: string;
  try { workspaceId = await authorizeBrand(saved.brandId, userId); } catch { throw new OAuthCallbackError('expired'); }
  if (!code || code.length > 4096) throw new OAuthCallbackError('denied', saved.brandId);
  try {
  const config = oauthConfig(provider);
  if (!config) throw new OAuthCallbackError('provider_error', saved.brandId);
  let token: TokenResponse;
  if (provider === 'x') token = await xToken({ grant_type: 'authorization_code', code, code_verifier: decryptCredentials(saved.codeVerifier).verifier, redirect_uri: callbackUrl(provider) });
  else if (provider === 'threads') {
    const short = await oauthJson<TokenResponse>('threads', '/oauth/access_token', { method: 'POST', body: new URLSearchParams({ client_id: config.id, client_secret: config.secret, grant_type: 'authorization_code', redirect_uri: callbackUrl(provider), code }) });
    if (!short.access_token) throw failure('AUTH_EXPIRED', 'Threads did not issue a token.');
    token = await oauthJson<TokenResponse>('threads', `/access_token?${new URLSearchParams({ grant_type: 'th_exchange_token', client_secret: config.secret, access_token: short.access_token })}`);
  } else if (provider === 'facebook') {
    const short = await facebookToken({ redirect_uri: callbackUrl(provider), code });
    if (!short.access_token) throw failure('AUTH_EXPIRED', 'Facebook did not issue a token.');
    const long = await facebookToken({ grant_type: 'fb_exchange_token', fb_exchange_token: short.access_token });
    // Keep the long-lived Page token; it does not expire while the user token stays valid, so no refresh is needed.
    const page = await facebookPageToken(long.access_token || short.access_token);
    token = { access_token: page.accessToken, expires_in: long.expires_in };
  } else token = await linkedinToken({ grant_type: 'authorization_code', code, redirect_uri: callbackUrl(provider) });
  const issuedCredentials = tokenCredentials(token);
  const account = await getPublisher(provider).validate(issuedCredentials);
  const credentials = { ...issuedCredentials, ...(provider === 'linkedin' || provider === 'facebook' ? { externalId: account.externalId } : {}) };
  workspaceId = await authorizeBrand(saved.brandId, userId);
  await db.transaction(async tx => {
    await tx.select().from(brands).where(eq(brands.id, saved.brandId)).for('update');
    const [existing] = await tx.select().from(channels).where(and(eq(channels.brandId, saved.brandId), eq(channels.provider, provider), eq(channels.externalId, account.externalId)));
    const values = { brandId: saved.brandId, provider, credentialsEnc: encryptCredentials(credentials), externalId: account.externalId, displayName: visibleIdentifier(account.displayName,"Channel name"), url: account.url ? linkInput(account.url) : null, meta: account.meta ?? {}, status: 'active' as const, lastCheckedAt: new Date(), lastHealthError: null };
    if (existing) await tx.update(channels).set(values).where(eq(channels.id, existing.id));
    else await tx.insert(channels).values(values);
    // A reconnected channel is active again: its mail locks reset so future incidents mail.
    if (existing) await clearChannelAlertLocks(tx, existing.id);
  });
  await recordFunnelEvent('channel_connected', { workspaceId });
  return saved.brandId;
  } catch { throw new OAuthCallbackError('provider_error', saved.brandId); }
}
