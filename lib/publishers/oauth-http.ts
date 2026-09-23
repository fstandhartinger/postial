import { failure, guarded, jsonResponse, responseError } from './http';
import { FACEBOOK_GRAPH_VERSION, oauthConfig, oauthEndpoint, type OAuthProvider } from './oauth-config';
import type { Credentials } from './types';
const oauthDisplay: Record<OAuthProvider, string> = { x: 'X', threads: 'Threads', linkedin: 'LinkedIn', facebook: 'Facebook', instagram: 'Instagram', tiktok: 'TikTok' };
export async function oauthJson<T>(provider: OAuthProvider, path: string, init: RequestInit = {}): Promise<T> {
  return (await oauthJsonResponse<T>(provider, path, init)).body;
}
export async function oauthJsonResponse<T>(provider: OAuthProvider, path: string, init: RequestInit = {}) {
  const url = oauthEndpoint(provider, path);
  const display = oauthDisplay[provider];
  if (process.env.NODE_ENV !== 'production' && url.startsWith('http://127.0.0.1:')) return guarded(provider, async () => {
    const response = await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(20000) });
    const body = await response.text().then(text => text ? JSON.parse(text) : {});
    if (!response.ok) throw responseError(display, response.status, body ?? {}, response.headers);
    if (body?.ok === false) throw responseError(display, body.error_code ?? 400, body, response.headers);
    return { body: body as T, response };
  });
  return jsonResponse<T>(display, url, init);
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
/** Meta's long-lived user token window: 60 days in seconds. */
export const FACEBOOK_LONG_LIVED_EXPIRES_IN = 5_184_000;
/** Meta may omit `expires_in` on re-authorization; Facebook/Instagram issuance falls back to the 60-day long-lived window. tokenCredentials stays strict for every provider. */
export function facebookExpiresIn(value?: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : FACEBOOK_LONG_LIVED_EXPIRES_IN;
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
/** Facebook exchanges both the code and the short token via the same GET endpoint, distinguished by query. Instagram reuses the same app and endpoint. */
export async function facebookToken(query: Record<string, string>, provider: 'facebook' | 'instagram' = 'facebook') {
  const config = oauthConfig(provider);
  if (!config) throw failure('AUTH_EXPIRED', `${oauthDisplay[provider]} connection is not configured.`);
  return oauthJson<TokenResponse>(provider, `/${FACEBOOK_GRAPH_VERSION}/oauth/access_token?${new URLSearchParams({ ...query, client_id: config.id, client_secret: config.secret })}`);
}
/** TikTok Login Kit v2 exchanges the code and refreshes via the same form-encoded endpoint; the refresh token rotates. */
export async function tiktokToken(body: Record<string, string>) {
  const config = oauthConfig('tiktok');
  if (!config) throw failure('AUTH_EXPIRED', 'TikTok connection is not configured.');
  const r = await oauthJson<{ access_token?: string; refresh_token?: string; expires_in?: number; open_id?: string }>('tiktok', '/v2/oauth/token/', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...body, client_key: config.id, client_secret: config.secret }) });
  if (!r.access_token) throw failure('AUTH_EXPIRED', 'TikTok did not issue a token.');
  return { token: { access_token: r.access_token, refresh_token: r.refresh_token, expires_in: r.expires_in }, openId: r.open_id };
}
export type FacebookPage = { id: string; name: string; accessToken: string };
type FacebookAccountsResponse = { data?: Array<{ id?: string; name?: string; access_token?: string }>; paging?: { next?: string } };
/** Facebook publishes as a Page: collect every usable Page returned by the Graph API. */
export async function facebookPages(userToken: string): Promise<FacebookPage[]> {
  const pages: FacebookPage[] = [];
  const seen = new Set<string>();
  const facebookOrigin = new URL(oauthEndpoint('facebook', '/')).origin;
  let path = `/${FACEBOOK_GRAPH_VERSION}/me/accounts?${new URLSearchParams({ fields: 'id,name,access_token', limit: '100', access_token: userToken })}`;
  for (let request = 0; request < 5; request++) {
    const r = await oauthJson<FacebookAccountsResponse>('facebook', path);
    for (const entry of r.data ?? []) {
      if (!entry.id || !entry.access_token || seen.has(entry.id)) continue;
      seen.add(entry.id);
      pages.push({ id: entry.id, name: entry.name ?? entry.id, accessToken: entry.access_token });
    }
    if (!r.paging?.next || request === 4) break;
    const next = new URL(r.paging.next, oauthEndpoint('facebook', '/'));
    if (next.origin !== facebookOrigin || next.username || next.password) break;
    path = next.pathname + next.search;
  }
  return pages;
}
/** Instagram Business publishing uses the Page token of the first manageable Page that has a linked Instagram account. */
export async function facebookInstagramToken(userToken: string) {
  const r = await oauthJson<{ data?: Array<{ id?: string; name?: string; access_token?: string; instagram_business_account?: { id?: string; username?: string } }> }>('instagram', `/${FACEBOOK_GRAPH_VERSION}/me/accounts?${new URLSearchParams({ fields: 'id,name,access_token,instagram_business_account{id,username}', access_token: userToken })}`);
  const page = r.data?.find(entry => entry.access_token && entry.instagram_business_account?.id);
  if (!page?.access_token || !page.instagram_business_account?.id) throw failure('AUTH_EXPIRED', 'No Instagram Business account linked to a Facebook Page was found. Connect a Page that has an Instagram Business account and reconnect.');
  return { accessToken: page.access_token, externalId: page.instagram_business_account.id, username: page.instagram_business_account.username ?? page.name ?? page.id };
}
