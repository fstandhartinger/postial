import { InputError } from '@/lib/api/input';
const hidden = /[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF\u061C]/u;
const bidi = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/gu;
export function visibleIdentifier(value: string, label = 'Value'): string {
  if (hidden.test(value)) throw new InputError(`${label} must not contain zero-width or bidirectional control characters.`);
  const normalized = value.normalize('NFKC').trim();
  if (hidden.test(normalized)) throw new InputError(`${label} contains invisible control characters.`);
  return normalized;
}
export const cleanText = (value: string) => value.replace(bidi, '').normalize('NFC');
export function linkInput(value: string): string {
  if (!value) return '';
  value = visibleIdentifier(value, 'URL');
  if (value.length > 2048) throw new InputError('URL must be at most 2048 characters.');
  try {
    const url = new URL(value);
    if (!['http:','https:'].includes(url.protocol) || url.username || url.password || url.href.length > 2048) throw new Error();
    // Percent-encoded controls must not acquire a second interpretation downstream.
    if (hidden.test(decodeURIComponent(url.href))) throw new Error();
    return url.href;
  } catch { throw new InputError('Use an HTTP(S) URL, at most 2048 characters, without credentials or invisible controls.'); }
}
