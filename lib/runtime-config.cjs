function encryptionKeys() {
  /** @type {Map<string, Buffer>} */
  const keys = new Map();
  /** @param {string} id @param {string} encoded */
  function add(id, encoded) {
    const value = Buffer.from(encoded, 'base64');
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(id) || value.length !== 32 || value.toString('base64') !== encoded || keys.has(id))
      throw new Error('Invalid APP_ENCRYPTION_KEY(S): require unique key IDs and canonical base64 32-byte keys');
    keys.set(id, value);
  }
  if (process.env.APP_ENCRYPTION_KEYS) {
    for (const entry of process.env.APP_ENCRYPTION_KEYS.split(',')) {
      const [id, value, extra] = entry.split(':');
      if (!id || !value || extra !== undefined) throw new Error('Invalid APP_ENCRYPTION_KEYS format');
      add(id, value);
    }
  }
  if (process.env.APP_ENCRYPTION_KEY) {
    if (keys.has('k0')) {
      if (keys.get('k0').toString('base64') !== process.env.APP_ENCRYPTION_KEY) throw new Error('Conflicting legacy k0 encryption key');
    } else add('k0', process.env.APP_ENCRYPTION_KEY);
  }
  if (!keys.size) throw new Error('APP_ENCRYPTION_KEY or APP_ENCRYPTION_KEYS is required');
  return keys;
}

function validateRuntimeConfig() {
  const missing = ['DATABASE_URL','AUTH_SECRET','CRON_SECRET'].filter(name => !process.env[name]);
  if (!process.env.APP_ENCRYPTION_KEY && !process.env.APP_ENCRYPTION_KEYS) missing.push('APP_ENCRYPTION_KEY(S)');
  if (missing.length) throw new Error('Missing required configuration: ' + missing.join(', '));
  encryptionKeys();
  const origins = ['APP_URL','AUTH_URL','NEXT_PUBLIC_APP_URL'].filter(name => !!process.env[name]).map(name => {
    try {
      const url = new URL(process.env[name]);
      if (!['http:','https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error();
      if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:' && !['localhost','127.0.0.1','[::1]'].includes(url.hostname)) throw new Error();
      return url.origin;
    } catch { throw new Error('Invalid canonical origin: ' + name); }
  });
  if (!origins.length) throw new Error('APP_URL, AUTH_URL or NEXT_PUBLIC_APP_URL is required');
  if (new Set(origins).size !== 1) throw new Error('Conflicting APP_URL/AUTH_URL/NEXT_PUBLIC_APP_URL origins');
}

module.exports = { encryptionKeys, validateRuntimeConfig };
