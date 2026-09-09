import { encryptionKeys } from './crypto';
export function validateConfig() {
  if (process.env.NEXT_PHASE === 'phase-production-build') return;
  const missing = ['DATABASE_URL','AUTH_SECRET','CRON_SECRET'].filter(name => !process.env[name]);
  if (!process.env.APP_ENCRYPTION_KEY && !process.env.APP_ENCRYPTION_KEYS) missing.push('APP_ENCRYPTION_KEY(S)');
  if (missing.length) throw new Error('Missing required configuration: ' + missing.join(', '));
  encryptionKeys();
  const origins = ['APP_URL','AUTH_URL','NEXT_PUBLIC_APP_URL'].filter(name => !!process.env[name]).map(name => {
    try {
      const url = new URL(process.env[name]!);
      if (!['http:','https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error();
      if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:' && !['localhost','127.0.0.1','[::1]'].includes(url.hostname)) throw new Error();
      return url.origin;
    } catch { throw new Error('Invalid canonical origin: ' + name); }
  });
  if (!origins.length) throw new Error('APP_URL, AUTH_URL or NEXT_PUBLIC_APP_URL is required');
  if (new Set(origins).size !== 1) throw new Error('Conflicting APP_URL/AUTH_URL/NEXT_PUBLIC_APP_URL origins');
}
