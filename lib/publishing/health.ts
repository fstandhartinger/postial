import { notifyWorkspace } from '@/lib/notifications';
import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { brands, channels } from '@/db/schema';
import { decryptCredentials, encryptCredentials } from '@/lib/crypto';
import { getPublisher, PublishError } from '@/lib/publishers';

export const healthErrorMessage = (code: string) => code === 'AUTH_EXPIRED'
  ? 'Access expired. Reconnect this channel.' : code === 'RATE_LIMITED'
  ? 'The provider is rate limiting checks. Try again later.' : 'The provider could not be reached or validated. Try again later.';
/** Row locks serialize validation with OAuth refresh and connection changes. */
export async function checkChannelHealth(id?: string, workspaceId?: string) {
  return getDb().transaction(async tx => {
    const rows = await tx.select({channel: channels, workspaceId: brands.workspaceId}).from(channels)
      .innerJoin(brands, eq(brands.id, channels.brandId))
      .where(and(sql`${channels.status} <> 'disconnected'`,
        id ? eq(channels.id, id) : sql`(${channels.lastCheckedAt} is null or ${channels.lastCheckedAt} <= now() - interval '24 hours')`,
        workspaceId ? eq(brands.workspaceId, workspaceId) : undefined,
        // Manual checks are bounded too, preventing repeated clicks from exhausting provider limits.
        id ? sql`(${channels.lastCheckedAt} is null or ${channels.lastCheckedAt} <= now() - interval '1 minute')` : undefined))
      .orderBy(sql`${channels.lastCheckedAt} asc nulls first`, channels.id)
      .limit(id ? 1 : 5).for('update', {of: channels, skipLocked: true});
    for (const {channel: c, workspaceId: ownerWorkspace} of rows) {
      let status = c.status, error: string | null = null;
      try {
        const publisher = getPublisher(c.provider);
        let credentials = decryptCredentials(c.credentialsEnc);
        if (publisher.refreshCredentials) {
          const refreshed = await publisher.refreshCredentials(credentials);
          if (refreshed) {
            credentials = refreshed;
            await tx.update(channels).set({credentialsEnc:encryptCredentials(refreshed)}).where(eq(channels.id,c.id));
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
      if(status==='token_expired' && c.status!=='token_expired') await notifyWorkspace(tx,ownerWorkspace,'token_expired');
      await tx.update(channels).set({status, lastCheckedAt: new Date(), lastHealthError: error}).where(eq(channels.id,c.id));
    }
    return {checked: rows.length};
  });
}
