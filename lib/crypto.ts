import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
export function encryptionKeys(): Map<string, Buffer> {
  const keys = new Map<string, Buffer>();
  function add(id: string, encoded: string) {
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
      if (keys.get('k0')!.toString('base64') !== process.env.APP_ENCRYPTION_KEY) throw new Error('Conflicting legacy k0 encryption key');
    } else add('k0', process.env.APP_ENCRYPTION_KEY);
  }
  if (!keys.size) throw new Error('APP_ENCRYPTION_KEY or APP_ENCRYPTION_KEYS is required');
  return keys;
}
export function currentKeyId() { return encryptionKeys().keys().next().value!; }
export function encryptCredentials(credentials: Record<string, string>): string {
  const keys = encryptionKeys(), id = keys.keys().next().value!;
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', keys.get(id)!, iv);
  cipher.setAAD(Buffer.from('v1:' + id));
  const data = Buffer.concat([cipher.update(JSON.stringify(credentials), 'utf8'), cipher.final()]);
  return ['v1', id, iv.toString('base64'), data.toString('base64'), cipher.getAuthTag().toString('base64')].join(':');
}
export function decryptCredentials(value: string): Record<string, string> {
  const keys = encryptionKeys();
  let id: string, iv: Buffer, data: Buffer, tag: Buffer;
  const versioned = value.startsWith('v1:');
  if (versioned) {
    const parts = value.split(':');
    if (parts.length !== 5) throw new Error('Invalid encrypted credentials');
    id = parts[1]; [iv, data, tag] = parts.slice(2).map(p => Buffer.from(p,'base64'));
  } else {
    const parts = value.split('.');
    if (parts.length !== 3) throw new Error('Unsupported encrypted credentials version');
    id = 'k0'; [iv, tag, data] = parts.map(p => Buffer.from(p,'base64'));
  }
  const key = keys.get(id);
  if (!key || iv.length !== 12 || tag.length !== 16) throw new Error('Encryption read key unavailable or invalid ciphertext');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  if (versioned) decipher.setAAD(Buffer.from('v1:' + id));
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8'));
}
