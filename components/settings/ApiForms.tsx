'use client';
import { useActionState } from 'react';
import { settingsAction, type SettingsState } from '@/app/app/settings/api/actions';
const scopes = ['posts:write', 'posts:read', 'brands:read', 'webhooks:manage'];
const events = ['post.published', 'post.failed', 'post.needs_review', 'approval.decided'];
export function ApiForm({kind, id}: {kind: 'create_key' | 'create_webhook' | 'revoke' | 'test_webhook' | 'disable_webhook' | 'enable_webhook' | 'delete_webhook'; id?: string}) {
  const [state, action, pending] = useActionState(settingsAction, {} as SettingsState);
  const labels = {create_key: 'Create API key', create_webhook: 'Create webhook', revoke: 'Revoke', test_webhook: 'Send test event', disable_webhook: 'Disable webhook', enable_webhook: 'Enable webhook', delete_webhook: 'Delete webhook'};
  return <form action={action} className="space-y-3 rounded-xl border border-slate-200 p-4">
    <input type="hidden" name="action" value={kind}/>{id && <input type="hidden" name="id" value={id}/>}
    {kind === 'create_key' && <><label className="block">Key name<input className="block w-full rounded border p-2" name="name" required maxLength={80} placeholder="n8n production"/></label><fieldset><legend>Scopes</legend>{scopes.map(scope => <label key={scope} className="mr-4 inline-flex gap-2"><input type="checkbox" name="scope" value={scope} defaultChecked/>{scope}</label>)}</fieldset></>}
    {kind === 'create_webhook' && <><label className="block">Endpoint URL<input className="block w-full rounded border p-2" name="url" type="url" required maxLength={2048} placeholder="https://example.com/webhooks/socialmint"/></label><fieldset><legend>Events</legend>{events.map(event => <label key={event} className="mr-4 inline-flex gap-2"><input type="checkbox" name="event" value={event} defaultChecked/>{event}</label>)}</fieldset></>}
    <button className="rounded bg-emerald-800 px-4 py-2 text-white disabled:opacity-50" disabled={pending}>{pending ? 'Saving…' : labels[kind]}</button>
    {state.error && <p role="alert" className="text-red-800">{state.error}</p>}
    {state.message && <p role="status">{state.message}</p>}
    {state.secret && <label className="block">Secret — save securely<input aria-label="One-time secret" readOnly value={state.secret} onFocus={e => e.target.select()} className="block w-full rounded border p-2 font-mono"/></label>}
  </form>;
}
