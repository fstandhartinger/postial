import sharp from 'sharp';
import { ApiError } from '@/lib/api/errors';
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_PIXELS = 25_000_000;
const invalid = () => new ApiError(422, 'invalid_image', 'Upload a complete, valid JPEG, PNG, WebP or GIF image (up to 25 megapixels).');
// Bound the GIF envelope as well as decoding pixels. Only animation/control
// extensions are retained; arbitrary comments/application payloads are rejected.
function gifEnvelope(input: Buffer) {
  let p = 13;
  if (input.length < p) throw invalid();
  if (input[10] & 128) p += 3 * (1 << ((input[10] & 7) + 1));
  let frames = 0;
  const blocks = () => {
    while (p < input.length) { const size = input[p++]; if (!size) return; p += size; }
    throw invalid();
  };
  while (p < input.length) {
    const marker = input[p++];
    if (marker === 0x3b) { if (p !== input.length || !frames) throw invalid(); return; }
    if (marker === 0x2c) {
      if (p+9 > input.length || ++frames > 200) throw invalid();
      const packed = input[p+8]; p += 9;
      if (packed & 128) p += 3 * (1 << ((packed & 7) + 1));
      p++; blocks();
    } else if (marker === 0x21) {
      const label = input[p++];
      if (label === 0xff) {
        if (input[p] !== 11 || !['NETSCAPE2.0','ANIMEXTS1.0'].includes(input.toString('ascii',p+1,p+12))) throw invalid();
      } else if (label !== 0xf9) throw invalid();
      blocks();
    } else throw invalid();
  }
  throw invalid();
}
/** Decode before storage; never trust client MIME, dimensions or header-only parsers. */
export async function normalizeImage(input: Buffer) {
  if (input.length > MAX_IMAGE_BYTES) throw new ApiError(413, 'image_too_large', 'Each image must be at most 5 MB.');
  try {
    const metadata = await sharp(input, {failOn:'warning', limitInputPixels:MAX_PIXELS}).metadata();
    const {format, width, height} = metadata;
    if (!format || !['jpeg','png','webp','gif'].includes(format) || !width || !height) throw invalid();
    const pages = metadata.pages ?? 1, frameHeight = metadata.pageHeight ?? height;
    if (width * frameHeight > MAX_PIXELS) throw invalid();
    if (format === 'gif') {
      if (pages > 200 || width * frameHeight * pages > 50_000_000) throw new ApiError(422, 'animation_too_large', 'GIFs must have at most 200 frames and 50 megapixels across all frames.');
      // All frames must decode, including the last frame. Preserve the original GIF.
      gifEnvelope(input);
      await sharp(input, {animated:true, failOn:'warning', limitInputPixels:50_000_000}).timeout({seconds:10}).stats();
      return {data:input, mime:'image/gif', width, height:frameHeight};
    }
    if (pages !== 1) throw new ApiError(422, 'invalid_image', 'Use a still JPEG, PNG or WebP image, or a GIF animation.');
    // Reject appended alternate payloads; normalization discards metadata and
    // ancillary chunks, so none of their content reaches public image responses.
    if (format === 'jpeg' && !input.subarray(-2).equals(Buffer.from([255,217]))) throw invalid();
    if (format === 'png' && !input.subarray(-12).equals(Buffer.from('0000000049454e44ae426082','hex'))) throw invalid();
    if (format === 'webp' && input.readUInt32LE(4)+8 !== input.length) throw invalid();
    for (const quality of [90,75,55,35]) {
      let pipeline = sharp(input, {failOn:'warning', limitInputPixels:MAX_PIXELS}).rotate().timeout({seconds:10});
      pipeline = format === 'jpeg' ? pipeline.jpeg({quality}) : format === 'webp' ? pipeline.webp({quality}) : pipeline.png(quality === 90 ? {compressionLevel:9} : {palette:true,quality,compressionLevel:9});
      const {data,info} = await pipeline.toBuffer({resolveWithObject:true});
      if (data.length <= MAX_IMAGE_BYTES) return {data,mime:`image/${format}`,width:info.width,height:info.height};
    }
    throw new ApiError(422, 'image_too_large', 'The processed image exceeds 5 MB. Resize it and try again.');
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw invalid();
  }
}
export async function imageInfo(input: Buffer) {
  const {mime,width,height} = await normalizeImage(input);
  return {mime,width,height};
}
