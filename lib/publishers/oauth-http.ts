import { failure, guarded, jsonResponse, responseError } from './http';
import { FACEBOOK_GRAPH_VERSION, oauthConfig, oauthEndpoint, type OAuthProvider } from './oauth-config';
import type { Credentials } from './types';
const oauthDisplay: Record<OAuthProvider, string> = { x: 'X', threads: 'Threads', linkedin: 'LinkedIn', facebook: 'Facebook' };
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
/** Facebook exchanges both the code and the short token via the same GET endpoint, distinguished by query. */
export async function facebookToken(query: Record<string, string>) {
  const config = oauthConfig('facebook');
  if (!config) throw failure('AUTH_EXPIRED', 'Facebook connection is not configured.');
  return oauthJson<TokenResponse>('facebook', `/${FACEBOOK_GRAPH_VERSION}/oauth/access_token?${new URLSearchParams({ ...query, client_id: config.id, client_secret: config.secret })}`);
}
/** Facebook publishes as a Page: resolve the first manageable Page and keep its long-lived Page token. */
export async function facebookPageToken(userToken: string) {
  const r = await oauthJson<{ data?: Array<{ id?: string; name?: string; access_token?: string }> }>('facebook', `/${FACEBOOK_GRAPH_VERSION}/me/accounts?${new URLSearchParams({ fields: 'id,name,access_token', access_token: userToken })}`);
  const page = r.data?.[0];
  if (!page?.id || !page.access_token) throw failure('AUTH_EXPIRED', 'No Facebook Page was found for this account. Grant the app access to a Page and reconnect.');
  return { accessToken: page.access_token, externalId: page.id, pageName: page.name ?? page.id };
}
