import { failure, guarded, json } from './http';
import { oauthConfig, oauthEndpoint, type OAuthProvider } from './oauth-config';
import type { Credentials } from './types';
export async function oauthJson<T>(provider: OAuthProvider, path: string, init: RequestInit = {}): Promise<T> {
  const url = oauthEndpoint(provider, path);
  if (process.env.NODE_ENV !== 'production' && url.startsWith('http://127.0.0.1:')) {
    return guarded(provider, async () => {
      const r = await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(20000) });
      if (!r.ok) throw failure(r.status === 429 ? 'RATE_LIMITED' : r.status >= 500 ? 'PROVIDER_DOWN' : 'AUTH_EXPIRED', `Reconnect ${provider === 'x' ? 'X' : 'Threads'}.`);
      if (r.status === 400 || r.status === 422) throw failure('CONTENT_REJECTED', `The ${provider} request was rejected.`);
      return await r.json() as T;
    });
  }
  return json<T>(provider === 'x' ? 'X' : provider === 'threads' ? 'Threads' : 'LinkedIn', url, init);
}
export function bearer(c: Credentials) {
  if (!c.accessToken) throw failure('AUTH_EXPIRED', 'Reconnect this channel.');
  return { Authorization: `Bearer ${c.accessToken}` };
}
export type TokenResponse = { access_token: string; refresh_token?: string; expires_in?: number };
export function tokenCredentials(token: TokenResponse, previous: Credentials = {}): Credentials {
  if (!token.access_token || !Number.isFinite(token.expires_in) || Number(token.expires_in) <= 0) throw failure('AUTH_EXPIRED', 'The provider did not issue a valid token. Reconnect the channel.');
  return { ...previous, accessToken: token.access_token, ...(token.refresh_token ? { refreshToken: token.refresh_token } : {}), expiresAt: String(Date.now() + Number(token.expires_in) * 1000), issuedAt: String(Date.now()) };
}
export async function xToken(body: Record<string, string>) {
  const config = oauthConfig('x');
  if (!config) throw failure('AUTH_EXPIRED', 'X connection is not configured.');
  return oauthJson<TokenResponse>('x', '/2/oauth2/token', { method: 'POST', headers: { Authorization: `Basic ${Buffer.from(`${encodeURIComponent(config.id)}:${encodeURIComponent(config.secret)}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...body, client_id: config.id }) });
}
export async function linkedinToken(body: Record<string, string>) {
  const config = oauthConfig('linkedin');
  if (!config) throw failure('AUTH_EXPIRED', 'LinkedIn connection is not configured.');
  return oauthJson<TokenResponse>('linkedin', '/oauth/v2/accessToken', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...body, client_id: config.id, client_secret: config.secret }) });
}
