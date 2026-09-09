import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { encryptionKeys } from './runtime-config.cjs';
export { encryptionKeys } from './runtime-config.cjs';
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
