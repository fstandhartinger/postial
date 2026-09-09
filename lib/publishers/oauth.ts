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
import { callbackUrl, oauthConfig, type OAuthProvider } from './oauth-config';
import { oauthJson, tokenCredentials, xToken, type TokenResponse } from './oauth-http';

async function authorizeBrand(brandId: string, userId: string) {
  if (!isUuid(brandId)) throw failure('AUTH_EXPIRED', 'Brand not found.');
  const [row] = await getDb().select({ brand: brands, role: workspaceMembers.role }).from(brands)
    .innerJoin(workspaceMembers, eq(workspaceMembers.workspaceId, brands.workspaceId))
    .where(and(eq(brands.id, brandId), eq(workspaceMembers.userId, userId)));
  if (!row || !await canEditBrand(row.brand.workspaceId, brandId)) throw failure('AUTH_EXPIRED', 'You cannot connect channels for this brand.');
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
  const url = new URL(provider === 'x' ? 'https://x.com/i/oauth2/authorize' : 'https://threads.net/oauth/authorize');
  url.search = new URLSearchParams({ client_id: config.id, redirect_uri: callbackUrl(provider), response_type: 'code', state,
    scope: provider === 'x' ? 'tweet.read tweet.write users.read offline.access media.write' : 'threads_basic,threads_content_publish',
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
  try { await authorizeBrand(saved.brandId, userId); } catch { throw new OAuthCallbackError('expired'); }
  if (!code || code.length > 4096) throw new OAuthCallbackError('denied', saved.brandId);
  try {
  const config = oauthConfig(provider);
  if (!config) throw new OAuthCallbackError('provider_error', saved.brandId);
  let token: TokenResponse;
  if (provider === 'x') token = await xToken({ grant_type: 'authorization_code', code, code_verifier: decryptCredentials(saved.codeVerifier).verifier, redirect_uri: callbackUrl(provider) });
  else {
    const short = await oauthJson<TokenResponse>('threads', '/oauth/access_token', { method: 'POST', body: new URLSearchParams({ client_id: config.id, client_secret: config.secret, grant_type: 'authorization_code', redirect_uri: callbackUrl(provider), code }) });
    if (!short.access_token) throw failure('AUTH_EXPIRED', 'Threads did not issue a token.');
    token = await oauthJson<TokenResponse>('threads', `/access_token?${new URLSearchParams({ grant_type: 'th_exchange_token', client_secret: config.secret, access_token: short.access_token })}`);
  }
  const credentials = tokenCredentials(token), account = await getPublisher(provider).validate(credentials);
  await authorizeBrand(saved.brandId, userId);
  await db.transaction(async tx => {
    await tx.select().from(brands).where(eq(brands.id, saved.brandId)).for('update');
    const [existing] = await tx.select().from(channels).where(and(eq(channels.brandId, saved.brandId), eq(channels.provider, provider), eq(channels.externalId, account.externalId)));
    const values = { brandId: saved.brandId, provider, credentialsEnc: encryptCredentials(credentials), externalId: account.externalId, displayName: visibleIdentifier(account.displayName,"Channel name"), url: account.url ? linkInput(account.url) : null, meta: account.meta ?? {}, status: 'active' as const, lastCheckedAt: new Date(), lastHealthError: null };
    if (existing) await tx.update(channels).set(values).where(eq(channels.id, existing.id));
    else await tx.insert(channels).values(values);
  });
  return saved.brandId;
  } catch { throw new OAuthCallbackError('provider_error', saved.brandId); }
}
