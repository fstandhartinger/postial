import { notifyLinkedInExpiring, notifyWorkspace } from '@/lib/notifications';
import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { brands, channels } from '@/db/schema';
import { decryptCredentials, encryptCredentials } from '@/lib/crypto';
import { getPublisher, PublishError } from '@/lib/publishers';

export const healthErrorMessage = (code: string) => code === 'AUTH_EXPIRED'
  ? 'Access expired. Reconnect this channel.' : code === 'RATE_LIMITED'
  ? 'The provider is rate limiting checks. Try again later.' : 'The provider could not be reached or validated. Try again later.';
/** Claim in a short transaction; network work outside; compare-and-set fences reconnect/refresh. */
export async function checkChannelHealth(id?: string, workspaceId?: string) {
  const claimedAt = new Date();
  const rows = await getDb().transaction(async tx => {
    const rows = await tx.select({channel: channels, workspaceId: brands.workspaceId}).from(channels)
      .innerJoin(brands, eq(brands.id, channels.brandId))
      .where(and(sql`${channels.status} <> 'disconnected'`,
        id ? eq(channels.id, id) : sql`(${channels.lastCheckedAt} is null or ${channels.lastCheckedAt} <= now() - interval '24 hours')`,
        workspaceId ? eq(brands.workspaceId, workspaceId) : undefined,
        // Manual checks are bounded too, preventing repeated clicks from exhausting provider limits.
        id ? sql`(${channels.lastCheckedAt} is null or ${channels.lastCheckedAt} <= now() - interval '1 minute')` : undefined))
      .orderBy(sql`${channels.lastCheckedAt} asc nulls first`, channels.id)
      .limit(id ? 1 : 5).for('update', {of: channels, skipLocked: true});
    for (const {channel: c} of rows) await tx.update(channels).set({lastCheckedAt:claimedAt}).where(eq(channels.id,c.id));
    return rows;
  });
    for (const {channel: c, workspaceId: ownerWorkspace} of rows) {
      let refreshedEnc = c.credentialsEnc;
      let status = c.status, error: string | null = null;
      try {
        const publisher = getPublisher(c.provider);
        let credentials = decryptCredentials(c.credentialsEnc);
        if (publisher.refreshCredentials) {
          const refreshed = await publisher.refreshCredentials(credentials);
          if (refreshed) {
            credentials = refreshed;
            refreshedEnc = encryptCredentials(refreshed);
          }
        }
        await publisher.validate(credentials);
        status = 'active';
      } catch (e) {
        const code = e instanceof PublishError ? e.code : 'UNKNOWN';
        if (code === 'AUTH_EXPIRED') status = 'token_expired';
        error = healthErrorMessage(code);
        console.warn('Channel health check failed', {provider: c.provider, code});
      }
      await getDb().transaction(async tx => {
        const warningCredentials = c.provider === 'linkedin' ? decryptCredentials(refreshedEnc) : null;
        const expiresAt = Number(warningCredentials?.expiresAt);
        const expiring = c.provider === 'linkedin' && status === 'active' && Number.isFinite(expiresAt) && expiresAt > Date.now() && expiresAt < Date.now() + 7 * 24 * 60 * 60 * 1000;
        const warning = expiring ? await notifyLinkedInExpiring(tx, ownerWorkspace, c.id, new Date(expiresAt)) : null;
        const updated = await tx.update(channels).set({status,credentialsEnc:refreshedEnc,lastHealthError:warning || error})
          .where(and(eq(channels.id,c.id),eq(channels.lastCheckedAt,claimedAt),eq(channels.credentialsEnc,c.credentialsEnc),eq(channels.status,c.status))).returning({id:channels.id});
        if(updated.length && status==='token_expired' && c.status!=='token_expired') await notifyWorkspace(tx,ownerWorkspace,'token_expired');
      });
    }
    return {checked: rows.length};
}
