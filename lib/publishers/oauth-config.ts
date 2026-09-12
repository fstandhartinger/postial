export type OAuthProvider = 'x' | 'threads' | 'linkedin' | 'facebook' | 'instagram';
export function isOAuthProvider(value: string): value is OAuthProvider { return value === 'x' || value === 'threads' || value === 'linkedin' || value === 'facebook' || value === 'instagram'; }
/** Graph API version shared by the Facebook adapter and its OAuth exchange. */
export const FACEBOOK_GRAPH_VERSION = process.env.FACEBOOK_GRAPH_VERSION || 'v21.0';
export function oauthConfig(provider: OAuthProvider) {
  const [id, secret] = provider === 'x' ? [process.env.X_CLIENT_ID, process.env.X_CLIENT_SECRET]
    : provider === 'threads' ? [process.env.THREADS_APP_ID, process.env.THREADS_APP_SECRET]
    : provider === 'facebook' || provider === 'instagram' ? [process.env.FACEBOOK_APP_ID, process.env.FACEBOOK_APP_SECRET]
    : [process.env.LINKEDIN_CLIENT_ID, process.env.LINKEDIN_CLIENT_SECRET];
  return id && secret ? { id, secret } : null;
}
export function appOrigin() {
  const url = new URL(process.env.APP_URL || process.env.AUTH_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000');
  if (url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname)))) throw new Error('Invalid APP_URL');
  return url.origin;
}
export function callbackUrl(provider: OAuthProvider) { return `${appOrigin()}/api/oauth/${provider}/callback`; }
const oauthBase: Record<OAuthProvider, string> = { x: 'https://api.x.com', threads: 'https://graph.threads.net', linkedin: 'https://api.linkedin.com', facebook: 'https://graph.facebook.com', instagram: 'https://graph.facebook.com' };
/** Literal loopback overrides are exclusively for the local HTTP verification harness. */
export function oauthEndpoint(provider: OAuthProvider, path: string) {
  const override = process.env[`${provider.toUpperCase()}_API_BASE_URL`];
  if (process.env.NODE_ENV !== 'production' && override) {
    const url = new URL(override);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password) throw new Error('Invalid test endpoint');
    return `${url.origin}${path}`;
  }
  return `${oauthBase[provider]}${path}`;
}
