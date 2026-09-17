import { localMediaUrl } from '@/lib/media/url';
import { AsyncLocalStorage } from 'node:async_hooks';
import { safeFetch } from './safe-fetch';
import { countText } from '../text-limits';
export { postText } from '../text-limits';
const deadlines = new AsyncLocalStorage<AbortSignal>();
export async function publishingDeadline<T>(work: () => Promise<T>, parent?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  const signal = parent ? AbortSignal.any([controller.signal, parent]) : controller.signal;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(failure('NETWORK', 'Publishing exceeded its 90 second deadline.')); }, 90_000); });
  try { return await deadlines.run(signal, () => Promise.race([work(), timeout])); } finally { clearTimeout(timer); }
}
export async function withAbortSignal<T>(work: () => Promise<T>, signal: AbortSignal): Promise<T> {
  const error = () => failure('NETWORK', 'The provider request was cancelled. Please try again.');
  if (signal.aborted) throw error();
  let onAbort: () => void = () => {};
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(error());
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try { return await Promise.race([work(), aborted]); }
  finally { signal.removeEventListener('abort', onAbort); }
}
export async function pollingPause() {
  deadlines.getStore()?.throwIfAborted();
  await new Promise(resolve => setTimeout(resolve, 1000));
  deadlines.getStore()?.throwIfAborted();
}
import { PublishError, type PublishErrorCode } from './types';

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

export function checkLength(provider: string, text: string, limit: number) {
  const length = countText(text);
  if (length > limit) throw failure('CONTENT_REJECTED', `${provider} allows ${limit} characters; this post has ${length}.`);
}

export function responseError(provider: string, status: number, body: Record<string, unknown>, headers: Headers) {
  const description = JSON.stringify(body);
  if (provider === 'X' && status === 403 && /duplicate/i.test(description)) return failure('DUPLICATE', 'X reports that this post already exists.');
  if (provider === 'Threads' && (body.error as {code?: number})?.code === 190) return failure('AUTH_EXPIRED', 'Reconnect Threads.');
  if (provider === 'LinkedIn' && (status === 409 || /duplicate|already exists|already posted/i.test(description))) return failure('DUPLICATE', 'LinkedIn reports that this post was already submitted.');
  if (provider === 'TikTok') {
    const code = String((body.error as { code?: unknown })?.code ?? '');
    if (code === 'unaudited_client_can_only_post_to_private_accounts') return failure('CONTENT_REJECTED', 'TikTok only allows private posts until the Postial app passes TikTok\'s audit, so this post was not published.');
    if (code === 'privacy_level_option_mismatch') return failure('CONTENT_REJECTED', 'TikTok rejected the post privacy setting. Reconnect the channel and try again.');
    if (code === 'spam_risk_user_banned_from_posting') return failure('CONTENT_REJECTED', 'TikTok has banned this account from posting, so the post was not published.');
    if (code === 'spam_risk_too_many_posts' || code === 'reached_active_user_cap') return failure('RATE_LIMITED', 'TikTok has reached its posting limit. Please try again later.');
  }
  if (status === 401 || status === 403 || /AuthenticationRequired|ExpiredToken|Unauthorized|bot was kicked|chat not found/i.test(description)) {
    return failure('AUTH_EXPIRED', provider === 'Bluesky' ? 'Bluesky rejected the app password. Reconnect the channel to continue posting.' : `${provider} rejected the credentials or channel access. Reconnect the channel to continue posting.`);
  }
  if (status === 429 || (provider === 'Threads' && [4, 17, 32, 613].includes(Number((body.error as {code?: number})?.code)))) {
    const parameters = body.parameters as { retry_after?: number } | undefined;
    const header = headers.get('retry-after');
    const reset = headers.get('x-rate-limit-reset');
    const seconds = (reset && Number.isFinite(Number(reset)) ? Math.max(0, Number(reset) - Date.now() / 1000) : undefined) ?? parameters?.retry_after ?? (header ? (/^\d+(\.\d+)?$/.test(header) ? Number(header) : Math.max(0, (Date.parse(header) - Date.now()) / 1000)) : undefined);
    return failure('RATE_LIMITED', `${provider} is receiving too many requests. Please try again later.`, seconds !== undefined && Number.isFinite(seconds) ? Math.ceil(seconds) : undefined);
  }
  if (status >= 500) return failure('PROVIDER_DOWN', `${provider} is temporarily unavailable. Please try again.`);
  if (provider === 'Mastodon' && (status === 409 || /duplicate|already (?:been )?(?:submitted|posted)|idempotency/i.test(description))) return failure('DUPLICATE', 'Mastodon reports that this post was already submitted.');
  if (status === 400 || status === 422) return failure('CONTENT_REJECTED', `${provider} rejected the post. Check the text length, image format and image size.`);
  return failure('UNKNOWN', `${provider} could not complete the request. Check the channel settings.`);
}

/** The deadline covers both fetching headers and consuming the response body. */
async function request<T>(provider: string, url: string, init: RequestInit, consume: (response: Response) => Promise<T>, maxBytes = 64 * 1024, allowMissing = false, timeoutMs = 20_000): Promise<T> {
  return guarded(provider, async () => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(failure('NETWORK', `${provider} did not respond within ${Math.round(timeoutMs / 1000)} seconds. Please try again.`)); }, timeoutMs);
    });
    try {
      const signal = AbortSignal.any([controller.signal, ...(init.signal ? [init.signal] : []), ...(deadlines.getStore() ? [deadlines.getStore()!] : [])]);
      return await Promise.race([withAbortSignal(async () => {
        const response = await safeFetch(url, { ...init, signal }, maxBytes, timeoutMs);
        if (!response.ok && !(allowMissing && response.status === 404)) {
          const body = await response.clone().json().catch(() => ({}));
          if (allowMissing && response.status === 400 && body.error === "RecordNotFound") return consume(response);
          throw responseError(provider, response.status, body ?? {}, response.headers);
        }
        return consume(response);
      }, signal), timeout ]);
    } finally { clearTimeout(timer); }
  });
}
export async function json<T>(provider: string, url: string, init: RequestInit = {}, allowMissing = false): Promise<T> {
  return (await jsonResponse<T>(provider, url, init, allowMissing)).body;
}
export async function jsonResponse<T>(provider: string, url: string, init: RequestInit = {}, allowMissing = false): Promise<{ body: T; response: Response }> {
  return request(provider, url, init, async response => {
    const body = response.status === 206 ? {} : await response.text().then(text => text ? JSON.parse(text) : {});
    if (body?.ok === false) throw responseError(provider, body.error_code ?? 400, body, response.headers);
    return { body: body as T, response };
  }, 64 * 1024, allowMissing);
}
export function jsonBody(body: unknown): RequestInit {
  return { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

/** Stream with a hard bound, including responses without Content-Length. */
export async function downloadImage(provider: string, url: string, maxBytes: number): Promise<Blob> {
  if (!localMediaUrl(url)) httpsOrigin(url);
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
  }, maxBytes);
}

/** Stream a video with a hard bound; the longer timeout fits files beyond a 20 second fetch. */
export async function downloadVideo(provider: string, url: string, maxBytes: number): Promise<Blob> {
  if (!localMediaUrl(url)) httpsOrigin(url);
  return request(provider, url, {}, async response => {
    const type = response.headers.get('content-type')?.split(';')[0] ?? '';
    if (!type.startsWith('video/')) throw failure('CONTENT_REJECTED', `${provider} requires a video URL with a video content type (MP4, WebM or MOV).`);
    const tooLarge = () => failure('CONTENT_REJECTED', `${provider} video exceeds the ${maxBytes} byte download limit.`);
    if (Number(response.headers.get('content-length')) > maxBytes) { await response.body?.cancel(); throw tooLarge(); }
    const reader = response.body?.getReader();
    if (!reader) throw failure('CONTENT_REJECTED', `${provider} received an empty video.`);
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
  }, maxBytes, false, 60_000);
}

/** One chunk of a provider-issued chunked upload (PUT with Content-Range). Returns the HTTP status (201 final, 206 partial).
 * An expired or unknown upload link is a flow problem, not a credential problem: a retry re-initializes the upload. */
export async function uploadChunk(provider: string, url: string, chunk: Uint8Array<ArrayBuffer>, headers: Record<string, string>): Promise<number> {
  try {
    return await request(provider, url, { method: 'PUT', headers, body: chunk }, async response => response.status, 64 * 1024);
  } catch (error) {
    if (error instanceof PublishError && ['AUTH_EXPIRED', 'CONTENT_REJECTED', 'UNKNOWN'].includes(error.code)) throw failure('NETWORK', `${provider} could not accept the uploaded chunk. Please try again.`);
    throw error;
  }
}
