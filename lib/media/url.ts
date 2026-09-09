import { ApiError } from '@/lib/api/errors';
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
  let url: URL;
  try { url = new URL(`/m/${id}`, process.env.NEXT_PUBLIC_APP_URL); }
  catch { throw new ApiError(422, 'media_origin_unconfigured', 'Image uploads need a configured app URL. Contact the workspace operator.'); }
  // Constructing a same-app URL does not perform an outbound request. Local
  // standalone tests may serve HTTP; publisher SSRF policy remains unchanged.
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)))
    throw new ApiError(422, 'invalid_media_origin', 'Image uploads need an HTTPS app URL (HTTP localhost is supported for local testing).');
  return url.href;
}
