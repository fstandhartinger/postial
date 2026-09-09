export function ownMediaId(value: string): string | null {
  try {
    const url = new URL(value), origin = new URL(process.env.NEXT_PUBLIC_APP_URL!).origin;
    return url.origin === origin && !url.username && !url.password ? /^\/m\/([A-Za-z0-9_-]{43})$/.exec(decodeURIComponent(url.pathname))?.[1] ?? null : null;
  } catch { return null; }
}
export function localMediaUrl(value: string): boolean {
  if (process.env.NODE_ENV === 'production' || process.env.MEDIA_ALLOW_LOOPBACK !== '1' || !ownMediaId(value)) return false;
  const url = new URL(value);
  return url.protocol === 'http:' && url.hostname === '127.0.0.1';
}
export function mediaUrl(id: string) {
  const url = new URL(`/m/${id}`, process.env.NEXT_PUBLIC_APP_URL);
  if (url.protocol !== 'https:' && !localMediaUrl(url.href)) throw new Error('NEXT_PUBLIC_APP_URL must use HTTPS');
  return url.href;
}
