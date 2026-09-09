import { createHash, randomBytes } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { brands, posts, workspaces } from '@/db/schema';
import { mediaAssets } from '@/db/media-schema';
import { workspaceEntitlements } from '@/lib/entitlements';
import { ApiError } from '@/lib/api/errors';
import { isUuid } from '@/lib/api/input';
import { normalizeImage } from './image';
import { mediaUrl } from './url';
export async function storeMedia(workspaceId: string, userId: string, data: Buffer, brandId?: string) {
  const {data:normalized, ...info} = await normalizeImage(data), access = await workspaceEntitlements(workspaceId);
  data = normalized;
  if (brandId && (!isUuid(brandId) || !access.activeBrandIds.includes(brandId))) throw new ApiError(422, 'invalid_brand', 'Choose an editable brand in this workspace.');
  const id = randomBytes(32).toString('base64url'), url = mediaUrl(id);
  await getDb().transaction(async tx => {
    await tx.select({id: workspaces.id}).from(workspaces).where(eq(workspaces.id, workspaceId)).for('update');
    const [usage] = await tx.select({bytes: sql<number>`coalesce(sum(${mediaAssets.bytes}), 0)`}).from(mediaAssets).where(eq(mediaAssets.workspaceId, workspaceId));
    if (Number(usage.bytes) + data.length > access.mediaBytes) throw new ApiError(422, 'storage_quota_exceeded', 'Workspace image storage is full. Remove unused uploads or upgrade your plan.');
    await tx.insert(mediaAssets).values({id, workspaceId, uploaderUserId: userId, brandId: brandId || null, ...info, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex'), data});
  });
  return {id, url, width: info.width, height: info.height, bytes: data.length};
}
export async function deleteMedia(workspaceId: string, id: string) {
  await getDb().transaction(async tx => {
    // Post writes take this same workspace lock before checking their assets.
    await tx.select({id: workspaces.id}).from(workspaces).where(eq(workspaces.id, workspaceId)).for('update');
    const [asset] = await tx.select({id: mediaAssets.id}).from(mediaAssets).where(and(eq(mediaAssets.id,id),eq(mediaAssets.workspaceId,workspaceId)));
    if (!asset) throw new ApiError(404,'not_found','Image not found.');
    const [ref] = await tx.select({id: posts.id}).from(posts).innerJoin(brands,eq(brands.id,posts.brandId)).where(sql`exists (select 1 from jsonb_array_elements_text(${posts.mediaUrls}) as media(url) where media.url ~ ${'/m/' + id + '$'})`).limit(1);
    if (ref) throw new ApiError(422,'media_in_use','This image is referenced by a post. Remove it from the post first.');
    await tx.delete(mediaAssets).where(eq(mediaAssets.id,id));
  });
}
