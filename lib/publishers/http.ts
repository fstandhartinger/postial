import { PublishError, type PublishErrorCode, type PublishInput } from './types';

export function failure(code: PublishErrorCode, humanMessage: string, retryAfterSeconds?: number) {
  return new PublishError({ code, humanMessage, retryable: ['NETWORK', 'PROVIDER_DOWN', 'RATE_LIMITED'].includes(code), retryAfterSeconds });
}

/** Do not retain underlying exceptions: fetch errors can contain credential-bearing URLs. */
export async function guarded<T>(provider: string, work: () => Promise<T>): Promise<T> {
  try { return await work(); } catch (error) {
    if (error instanceof PublishError) throw error;
    throw failure('NETWORK', `${provider} could not be reached. Please try again.`);
  }
}

export function httpsOrigin(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error();
    return url.origin;
  } catch { throw failure('CONTENT_REJECTED', 'Enter a valid HTTPS server URL without embedded credentials.'); }
}

export function postText(input: PublishInput) {
  return input.linkUrl && !input.text.includes(input.linkUrl) ? `${input.text}\n${input.linkUrl}` : input.text;
}
export function checkLength(provider: string, text: string, limit: number, graphemes = false) {
  const length = graphemes ? Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)).length : text.length;
  if (length > limit) throw failure('CONTENT_REJECTED', `${provider} allows ${limit} characters; this post has ${length}.`);
}

function responseError(provider: string, status: number, body: Record<string, unknown>, headers: Headers) {
  const description = `${body.error ?? ''} ${body.description ?? ''}`;
  if (status === 401 || status === 403 || /AuthenticationRequired|ExpiredToken|Unauthorized|bot was kicked|chat not found/i.test(description)) {
    return failure('AUTH_EXPIRED', provider === 'Bluesky' ? 'Bluesky rejected the app password. Reconnect the channel to continue posting.' : `${provider} rejected the credentials or channel access. Reconnect the channel to continue posting.`);
  }
  if (status === 429) {
    const parameters = body.parameters as { retry_after?: number } | undefined;
    const header = headers.get('retry-after');
    const seconds = parameters?.retry_after ?? (header ? (/^\d+(\.\d+)?$/.test(header) ? Number(header) : Math.max(0, (Date.parse(header) - Date.now()) / 1000)) : undefined);
    return failure('RATE_LIMITED', `${provider} is receiving too many requests. Please try again later.`, seconds !== undefined && Number.isFinite(seconds) ? Math.ceil(seconds) : undefined);
  }
  if (status >= 500) return failure('PROVIDER_DOWN', `${provider} is temporarily unavailable. Please try again.`);
  if (provider === 'Mastodon' && (status === 409 || /duplicate|already (?:been )?(?:submitted|posted)|idempotency/i.test(description))) return failure('DUPLICATE', 'Mastodon reports that this post was already submitted.');
  if (status === 400 || status === 422) return failure('CONTENT_REJECTED', `${provider} rejected the post. Check the text length, image format and image size.`);
  return failure('UNKNOWN', `${provider} could not complete the request. Check the channel settings.`);
}

/** The deadline covers both fetching headers and consuming the response body. */
async function request<T>(provider: string, url: string, init: RequestInit, consume: (response: Response) => Promise<T>): Promise<T> {
  return guarded(provider, async () => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(failure('NETWORK', `${provider} did not respond within 20 seconds. Please try again.`)); }, 20_000);
    });
    try {
      return await Promise.race([ (async () => {
        const response = await fetch(url, { ...init, redirect: 'error', signal: controller.signal });
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw responseError(provider, response.status, body ?? {}, response.headers);
        }
        return consume(response);
      })(), timeout ]);
    } finally { clearTimeout(timer); }
  });
}
export async function json<T>(provider: string, url: string, init: RequestInit = {}): Promise<T> {
  return request(provider, url, init, async response => {
    const body = response.status === 206 ? {} : await response.json();
    if (body?.ok === false) throw responseError(provider, body.error_code ?? 400, body, response.headers);
    return body as T;
  });
}
export function jsonBody(body: unknown): RequestInit {
  return { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

/** Stream with a hard bound, including responses without Content-Length. */
export async function downloadImage(provider: string, url: string, maxBytes: number): Promise<Blob> {
  httpsOrigin(url);
  return request(provider, url, {}, async response => {
    const type = response.headers.get('content-type')?.split(';')[0] ?? '';
    if (!type.startsWith('image/')) throw failure('CONTENT_REJECTED', `${provider} requires an image URL with an image content type.`);
    const tooLarge = () => failure('CONTENT_REJECTED', `${provider} image exceeds the ${maxBytes} byte download limit.`);
    if (Number(response.headers.get('content-length')) > maxBytes) { await response.body?.cancel(); throw tooLarge(); }
    const reader = response.body?.getReader();
    if (!reader) throw failure('CONTENT_REJECTED', `${provider} received an empty image.`);
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) throw tooLarge();
        chunks.push(new Uint8Array(value));
      }
    } finally { await reader.cancel(); }
    return new Blob(chunks, { type });
  });
}
