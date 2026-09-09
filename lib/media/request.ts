import { ApiError, json } from '@/lib/api/errors';
import { MAX_IMAGE_BYTES } from './image';
import { storeMedia } from './service';
// Per-process session upload budget. API keys additionally use their persistent 60/min budget.
const windows = new Map<string, {count: number; reset: number}>();
export async function uploadMedia(request: Request, workspaceId: string, userId: string, allowJson = false) {
  const now = Date.now(), key = workspaceId + ':' + userId;
  for (const [k,v] of windows) if (v.reset <= now) windows.delete(k);
  const window = windows.get(key) ?? {count:0, reset:now+60000}; windows.set(key,window);
  if (++window.count > 30) throw new ApiError(429,'rate_limited','Upload limit of 30 images per minute exceeded.',Math.max(1,Math.ceil((window.reset-now)/1000)));
  const isJson = request.headers.get('content-type')?.split(';')[0] === 'application/json';
  const max = isJson ? Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 4096 : MAX_IMAGE_BYTES + 65536;
  const tooLarge = () => new ApiError(413,'image_too_large','Each image must be at most 5 MB.');
  if (Number(request.headers.get('content-length')) > max) throw tooLarge();
  const reader = request.body?.getReader(); if (!reader) throw new ApiError(422,'invalid_image','Choose an image.');
  const chunks: Uint8Array[] = []; let size = 0;
  try { while (true) { const {done,value} = await reader.read(); if (done) break; size += value.length; if (size > max) throw tooLarge(); chunks.push(value); } }
  finally { await reader.cancel(); }
  const body = Buffer.concat(chunks); let data: Buffer, brandId: string | undefined;
  try {
    if (isJson && allowJson) {
      const parsed = JSON.parse(body.toString());
      if (typeof parsed.data !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(parsed.data)) throw new Error();
      data = Buffer.from(parsed.data,'base64'); if (data.toString('base64') !== parsed.data) throw new Error(); brandId = parsed.brand_id;
      if (brandId !== undefined && typeof brandId !== 'string') throw new Error();
    } else {
      const form = await new Request(request.url,{method:'POST',headers:request.headers,body}).formData();
      const file = form.get('file'); if (!(file instanceof File) || form.getAll('file').length !== 1) throw new Error();
      data = Buffer.from(await file.arrayBuffer()); brandId = String(form.get('brand_id') ?? '') || undefined;
    }
  } catch { throw new ApiError(422,'invalid_upload','Send one image as multipart file, or API JSON with Base64 data.'); }
  return json(await storeMedia(workspaceId,userId,data,brandId),201);
}
