import { anonymousLimit } from '@/lib/rate-limit';
import { sql } from 'drizzle-orm';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { mediaAssets } from '@/db/media-schema';
export const runtime = 'nodejs';
export async function GET(request: Request, {params}: {params: Promise<{id:string}>}) {
  const limited = await anonymousLimit(request.headers, 'media', 300);
  if (limited) return limited;
  const {id} = await params;
  if (!/^[A-Za-z0-9_-]{43}$/.test(id)) return new Response(null,{status:404});
  const [asset] = await getDb().select({mime:mediaAssets.mime, sha256:mediaAssets.sha256, bytes:mediaAssets.bytes}).from(mediaAssets).where(eq(mediaAssets.id,id));
  if (!asset) {
    const gone = await getDb().execute(sql`select 1 from media_tombstones where id = ${id}`);
    return new Response(null,{status:gone.length ? 410 : 404,headers:{'Cache-Control':'no-store'}});
  }
  const etag = `"${asset.sha256}"`;
  const headers = {'Content-Type':asset.mime,'Cache-Control':'private, no-store, max-age=0','X-Content-Type-Options':'nosniff',ETag:etag};
  if (request.headers.get('if-none-match')?.split(',').some(v => v.trim().replace(/^W\//,'') === etag || v.trim() === '*')) return new Response(null,{status:304,headers});
  const [content] = await getDb().select({data:mediaAssets.data}).from(mediaAssets).where(eq(mediaAssets.id,id));
  if (!content) return new Response(null,{status:404});
  return new Response(new Uint8Array(content.data.buffer as ArrayBuffer, content.data.byteOffset, content.data.byteLength),{headers:{...headers,'Content-Length':String(asset.bytes)}});
}
