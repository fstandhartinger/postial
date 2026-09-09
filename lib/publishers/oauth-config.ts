export type OAuthProvider = 'x' | 'threads' | 'linkedin';
export function isOAuthProvider(value: string): value is OAuthProvider { return value === 'x' || value === 'threads' || value === 'linkedin'; }
export function oauthConfig(provider: OAuthProvider) {
  const id = process.env[provider === 'x' ? 'X_CLIENT_ID' : provider === 'threads' ? 'THREADS_APP_ID' : 'LINKEDIN_CLIENT_ID'];
  const secret = process.env[provider === 'x' ? 'X_CLIENT_SECRET' : provider === 'threads' ? 'THREADS_APP_SECRET' : 'LINKEDIN_CLIENT_SECRET'];
  return id && secret ? { id, secret } : null;
}
export function appOrigin() {
  const url = new URL(process.env.APP_URL || process.env.AUTH_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000');
  if (url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname)))) throw new Error('Invalid APP_URL');
  return url.origin;
}
export function callbackUrl(provider: OAuthProvider) { return `${appOrigin()}/api/oauth/${provider}/callback`; }
/** Literal loopback overrides are exclusively for the local HTTP verification harness. */
export function oauthEndpoint(provider: OAuthProvider, path: string) {
  const override = process.env[`${provider.toUpperCase()}_API_BASE_URL`];
  if (process.env.NODE_ENV !== 'production' && override) {
    const url = new URL(override);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password) throw new Error('Invalid test endpoint');
    return `${url.origin}${path}`;
  }
  return `${provider === 'x' ? 'https://api.x.com' : provider === 'threads' ? 'https://graph.threads.net' : 'https://api.linkedin.com'}${path}`;
}
