import Link from 'next/link';
import { desc, eq } from 'drizzle-orm';
import { coreContext } from '@/lib/core';
import { agencyAccess } from '@/lib/api/auth';
import { apiKeys, webhookDeliveries, webhookEndpoints } from '@/db/schema';
import { ApiForm } from '@/components/settings/ApiForms';
export const metadata = {title: 'API settings'};
export default async function ApiSettings() {
  const {db, workspace, userId} = await coreContext();
  if (workspace.ownerUserId !== userId) return <p>Only the workspace owner can manage API settings.</p>;
  const allowed = await agencyAccess(workspace.id);
  const keys = await db.select({id: apiKeys.id, name: apiKeys.name, prefix: apiKeys.keyPrefix, scopes: apiKeys.scopes,
    lastUsedAt: apiKeys.lastUsedAt, revokedAt: apiKeys.revokedAt}).from(apiKeys).where(eq(apiKeys.workspaceId, workspace.id)).orderBy(desc(apiKeys.createdAt));
  const endpoints = await db.select({id: webhookEndpoints.id, url: webhookEndpoints.url, events: webhookEndpoints.events, active: webhookEndpoints.active})
    .from(webhookEndpoints).where(eq(webhookEndpoints.workspaceId, workspace.id)).orderBy(desc(webhookEndpoints.createdAt));
  const deliveries = await db.select({id: webhookDeliveries.id, url: webhookEndpoints.url, event: webhookDeliveries.event,
    status: webhookDeliveries.status, attempts: webhookDeliveries.attempts, response: webhookDeliveries.responseStatus,
    next: webhookDeliveries.nextAttemptAt, createdAt: webhookDeliveries.createdAt}).from(webhookDeliveries)
    .innerJoin(webhookEndpoints, eq(webhookEndpoints.id, webhookDeliveries.endpointId))
    .where(eq(webhookEndpoints.workspaceId, workspace.id)).orderBy(desc(webhookDeliveries.createdAt)).limit(20);
  return <div className="mx-auto max-w-5xl space-y-8 p-6"><h1 className="text-3xl font-bold">API &amp; webhooks</h1>
    <div className="rounded-xl bg-emerald-50 p-5"><p>API keys and webhooks require Agency, including an Agency trial. Each key permits 60 requests per minute.</p>
      {!allowed && <p><Link className="underline" href="/app/billing">Upgrade to Agency</Link> to create keys and connect your workflows.</p>}
      <p><Link className="underline" href="/docs/api">API documentation</Link> · <a className="underline" href="/openapi.json">OpenAPI specification</a></p>
      <pre className="mt-4 overflow-x-auto text-sm">{'curl https://socialmint.app.mintapis.com/api/v1/me \\\n  -H "Authorization: Bearer $SOCIALMINT_API_KEY"'}</pre></div>
    <section className="space-y-4"><h2 className="text-xl font-bold">API keys</h2>{allowed && <ApiForm kind="create_key"/>}
      {!keys.length && <p>No API keys yet.</p>}{keys.map(key => <article className="rounded border p-4" key={key.id}><h3 className="font-bold">{key.name}</h3><p>Prefix: {key.prefix}… · {key.scopes.join(', ')}</p><p>Last used: {key.lastUsedAt?.toISOString() ?? 'Never'}</p>{key.revokedAt ? <p>Revoked</p> : <ApiForm kind="revoke" id={key.id}/>}</article>)}</section>
    <section className="space-y-4"><h2 className="text-xl font-bold">Webhook endpoints</h2><p>Use a public HTTPS URL. Save the signing secret when creating an endpoint. Delivery is asynchronous; refresh this page for updates.</p>{allowed && <ApiForm kind="create_webhook"/>}
      {!endpoints.length && <p>No webhook endpoints yet.</p>}{endpoints.map(endpoint => <article className="space-y-2 rounded border p-4" key={endpoint.id}><h3 className="break-all font-bold">{endpoint.url}</h3><p>{endpoint.events.join(', ')}</p>{endpoint.active ? <>{allowed && <ApiForm kind="test_webhook" id={endpoint.id}/>}<ApiForm kind="disable_webhook" id={endpoint.id}/></> : <p>Disabled</p>}</article>)}</section>
    <section><h2 className="text-xl font-bold">Latest 20 deliveries</h2><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{['Created', 'Endpoint', 'Event', 'Status', 'Attempts', 'HTTP', 'Next attempt'].map(h => <th className="p-2" key={h}>{h}</th>)}</tr></thead><tbody>{deliveries.map(d => <tr key={d.id}><td className="p-2">{d.createdAt.toISOString()}</td><td className="max-w-60 break-all p-2">{d.url}</td><td>{d.event}</td><td>{d.status}</td><td>{d.attempts}</td><td>{d.response ?? '—'}</td><td>{d.next?.toISOString() ?? '—'}</td></tr>)}</tbody></table></div>{!deliveries.length && <p>No deliveries yet.</p>}</section>
  </div>;
}
