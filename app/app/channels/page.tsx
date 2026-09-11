import Link from 'next/link';
import { eq, sql } from 'drizzle-orm';
import { brands, channels } from '@/db/schema';
import { coreContext } from '@/lib/core';
import { workspaceEntitlements } from '@/lib/entitlements';
import { ChannelStatusBadge } from '@/components/app/channel-status-badge';
import { ProviderBadge } from '@/components/app/provider-badge';
import { ActionForm } from '@/components/core/forms';
import { Card } from '@/components/ui/card';
export default async function ChannelsPage() {
  const {db,workspace} = await coreContext();
  const access = await workspaceEntitlements(workspace);
  const rows = await db.select({id:channels.id,brandId:brands.id,brand:brands.name,provider:channels.provider,
    name:channels.displayName,status:channels.status,checkedAt:channels.lastCheckedAt,healthError:channels.lastHealthError,meta:channels.meta,
    publishedAt:sql<string|null>`(select max(t.published_at) from post_targets t where t.channel_id = ${channels.id})`,
    publishErrorAt:sql<string|null>`(select t.updated_at from post_targets t where t.channel_id = ${channels.id} and t.last_error_human is not null order by t.updated_at desc limit 1)`,
    publishError:sql<string|null>`(select t.last_error_human from post_targets t where t.channel_id = ${channels.id} and t.last_error_human is not null order by t.updated_at desc limit 1)`
  }).from(channels).innerJoin(brands,eq(brands.id,channels.brandId)).where(eq(brands.workspaceId,workspace.id)).orderBy(brands.name,channels.displayName);
  return <><h1>Channels</h1><Link href="/docs/channels" target="_blank" rel="noopener noreferrer" aria-label="Channels help (opens in a new tab)" title="Channels help" className="inline-flex h-8 w-8 items-center justify-center rounded-full border text-sm">?</Link><p className="text-zinc-600">Connection health across all brands. Automatic checks run daily. Manual checks are limited to once a minute.</p>
    {!rows.length && <Card><h2>No channels yet</h2><p>Connect your first account from a brand.</p><Link className="underline" href="/app/brands">Choose a brand</Link></Card>}
    <div className="grid gap-4 lg:grid-cols-2">{rows.map(c=><Card key={c.id} className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-center gap-2"><ProviderBadge provider={c.provider}/><ChannelStatusBadge status={c.status}/></div>
      {c.provider==='mastodon' && c.meta?.automated===false && (
        /* Our own test account was suspended two days after it began posting unattended
           without this flag set, which ends publishing for that account for good. */
        <p className="mt-2 text-sm text-amber-800">
          Mastodon does not list this account as automated. Many instances require that for
          unattended posting and may suspend accounts that do not. You can set it under
          Preferences → Profile → This is an automated account.
        </p>
      )}
      <h2 className="break-words">{c.name}</h2><Link className="underline" href={`/app/brands/${c.brandId}`}>{c.brand}</Link>
      <p>Last successful post: {c.publishedAt ? new Date(c.publishedAt).toLocaleString('en-GB',{timeZone:'UTC'})+' UTC' : 'No successful posts yet'}</p>
      <p className="break-words">Last error: {(c.healthError && (!c.publishErrorAt || !c.checkedAt || +c.checkedAt >= +new Date(c.publishErrorAt)) ? c.healthError : c.publishError) || 'No errors recorded'}</p>
      <p className="text-sm text-zinc-600">Last checked: {c.checkedAt ? c.checkedAt.toLocaleString('en-GB',{timeZone:'UTC'})+' UTC' : 'Not checked yet'}</p>
      {access.activeBrandIds.includes(c.brandId) ? <div className="flex flex-wrap items-center gap-3">
        <Link className="underline" href={`/app/brands/${c.brandId}#connect`}>Reconnect</Link>
        <ActionForm action="check_channel" disabled={c.status==='disconnected'}><input type="hidden" name="channelId" value={c.id}/></ActionForm>
        <ActionForm action="disconnect" disabled={c.status==='disconnected'}><input type="hidden" name="channelId" value={c.id}/><input type="hidden" name="brandId" value={c.brandId}/><input type="hidden" name="returnTo" value="channels"/></ActionForm>
      </div> : <p>This brand is read-only. <Link className="underline" href="/app/billing">Review Billing</Link></p>}
    </Card>)}</div></>;
}
