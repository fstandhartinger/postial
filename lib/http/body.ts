import { ApiError } from '@/lib/api/errors';
export const JSON_LIMIT = 64 * 1024;
export const BULK_LIMIT = 2 * 1024 * 1024;
export const WEBHOOK_LIMIT = 512 * 1024;
/** Bound bytes before parsing, including dishonest/missing Content-Length and stalled streams. */
export async function readBody(request: Request, limit = JSON_LIMIT, deadlineMs = 10000): Promise<Buffer> {
  const length = request.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > limit))
    throw new ApiError(413, 'payload_too_large', `Request exceeds ${limit} bytes.`);
  const reader = request.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ApiError(408, 'body_timeout', 'Request body read deadline exceeded.')), deadlineMs);
  });
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const {done, value} = await Promise.race([reader.read(), timeout]);
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new ApiError(413, 'payload_too_large', `Request exceeds ${limit} bytes.`);
      chunks.push(value);
    }
    return Buffer.concat(chunks, size);
  } finally {
    clearTimeout(timer);
    // A malicious stream's cancel callback must not extend our deadline.
    void reader.cancel().catch(() => {});
  }
}
export async function readJson(request: Request, limit = JSON_LIMIT): Promise<unknown> {
  const body = await readBody(request, limit);
  try { return JSON.parse(body.toString('utf8')); }
  catch { throw new ApiError(422, 'validation_error', 'Invalid JSON.'); }
}
export async function readForm(request: Request, limit = JSON_LIMIT): Promise<FormData> {
  const body = await readBody(request, limit);
  try { return await new Request(request.url, {method:'POST', headers:request.headers, body:new Uint8Array(body)}).formData(); }
  catch { throw new ApiError(422, 'validation_error', 'Invalid form data.'); }
}
