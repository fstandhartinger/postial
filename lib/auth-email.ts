/** Bound before Nodemailer's address parser; identity only, never a mail options object. */
export function normalizeEmail(identifier: string): string {
  if (typeof identifier !== 'string' || identifier.length > 254) throw new Error('Invalid email address');
  const value = identifier.normalize('NFKC').trim().toLowerCase();
  if (value.length > 254 || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i.test(value) || value.startsWith('.') || value.includes('..') || value.includes('.@')) throw new Error('Invalid email address');
  return value;
}
