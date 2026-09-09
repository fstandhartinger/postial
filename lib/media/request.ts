import { readBody } from '@/lib/http/body';
import { sharedRateLimit } from '@/lib/rate-limit';
import { ApiError, json } from '@/lib/api/errors';
import { MAX_IMAGE_BYTES } from './image';
import { storeMedia } from './service';
export async function uploadMedia(request: Request, workspaceId: string, userId: string, allowJson = false) {
  const retry = await sharedRateLimit('upload:' + workspaceId + ':' + userId, 30, 60);
  if (retry) throw new ApiError(429,'rate_limited','Upload limit of 30 images per minute exceeded.',retry);
  const isJson = request.headers.get('content-type')?.split(';')[0] === 'application/json';
  const max = isJson ? Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 4096 : MAX_IMAGE_BYTES + 65536;
  const body = await readBody(request, max); let data: Buffer, brandId: string | undefined;
  try {
    if (isJson && allowJson) {
      const parsed = JSON.parse(body.toString());
      if (typeof parsed.data !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(parsed.data)) throw new Error();
      data = Buffer.from(parsed.data,'base64'); if (data.toString('base64') !== parsed.data) throw new Error(); brandId = parsed.brand_id;
      if (brandId !== undefined && typeof brandId !== 'string') throw new Error();
    } else {
      const form = await new Request(request.url,{method:'POST',headers:request.headers,body:new Uint8Array(body)}).formData();
      const file = form.get('file'); if (!(file instanceof File) || form.getAll('file').length !== 1) throw new Error();
      data = Buffer.from(await file.arrayBuffer()); brandId = String(form.get('brand_id') ?? '') || undefined;
    }
  } catch { throw new ApiError(422,'invalid_upload','Send one image as multipart file, or API JSON with Base64 data.'); }
  return json(await storeMedia(workspaceId,userId,data,brandId),201);
}
