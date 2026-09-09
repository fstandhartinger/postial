import { ApiError } from '@/lib/api/errors';
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export function imageInfo(b: Buffer) {
  const invalid = () => new ApiError(422, 'invalid_image', 'Upload a valid JPEG, PNG, WebP or GIF image.');
  if (b.length > MAX_IMAGE_BYTES) throw new ApiError(413, 'image_too_large', 'Each image must be at most 5 MB.');
  let mime = '', width = 0, height = 0;
  try {
    if (b.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) && b.readUInt32BE(8) === 13 && b.toString('ascii', 12, 16) === 'IHDR') {
      mime = 'image/png'; width = b.readUInt32BE(16); height = b.readUInt32BE(20);
      if (b.length < 45 || !b.subarray(-12).equals(Buffer.from('0000000049454e44ae426082','hex'))) throw invalid();
    } else if (['GIF87a', 'GIF89a'].includes(b.toString('ascii', 0, 6))) {
      mime = 'image/gif'; width = b.readUInt16LE(6); height = b.readUInt16LE(8);
      if (b.length < 14 || b[b.length - 1] !== 0x3b) throw invalid();
    } else if (b[0] === 0xff && b[1] === 0xd8 && b[b.length - 2] === 0xff && b[b.length - 1] === 0xd9) {
      mime = 'image/jpeg'; let p = 2;
      while (p < b.length - 2) {
        if (b[p++] !== 0xff) throw invalid();
        while (b[p] === 0xff) p++;
        const marker = b[p++];
        if (marker === 0xda || marker === 0xd9) break;
        if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
        const size = b.readUInt16BE(p);
        if (size < 2 || p + size > b.length) throw invalid();
        if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) {
          if (size < 8) throw invalid(); height = b.readUInt16BE(p+3); width = b.readUInt16BE(p+5); break;
        }
        p += size;
      }
    } else if (b.toString('ascii',0,4) === 'RIFF' && b.toString('ascii',8,12) === 'WEBP' && b.readUInt32LE(4) + 8 === b.length) {
      mime = 'image/webp'; const kind = b.toString('ascii',12,16);
      if (b.readUInt32LE(16) + 20 > b.length) throw invalid();
      if (kind === 'VP8X' && b.readUInt32LE(16) === 10) { width = b.readUIntLE(24,3)+1; height = b.readUIntLE(27,3)+1; }
      else if (kind === 'VP8L' && b[20] === 0x2f) { const bits = b.readUInt32LE(21); width = (bits & 0x3fff)+1; height = ((bits >>> 14) & 0x3fff)+1; }
      else if (kind === 'VP8 ' && b.subarray(23,26).equals(Buffer.from([0x9d,0x01,0x2a]))) { width = b.readUInt16LE(26)&0x3fff; height = b.readUInt16LE(28)&0x3fff; }
    }
  } catch { throw invalid(); }
  if (!mime || !width || !height) throw invalid();
  return {mime, width, height};
}
