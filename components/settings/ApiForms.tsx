'use client';
import { useActionState } from 'react';
import { settingsAction, type SettingsState } from '@/app/app/settings/api/actions';
const scopes = ['posts:write', 'posts:read', 'brands:read', 'webhooks:manage'];
const scopeHelp: Record<string, string> = {
  'posts:write': 'create, edit, publish and delete posts',
  'posts:read': 'read posts and their delivery status',
  'brands:read': 'read brands and channels (needed for n8n dropdowns)',
  'webhooks:manage': 'register and manage n8n trigger webhooks',
};
const events = ['post.published', 'post.failed', 'post.needs_review', 'approval.decided'];
export function ApiForm({kind, id}: {kind: 'create_key' | 'create_webhook' | 'revoke' | 'test_webhook' | 'disable_webhook' | 'enable_webhook' | 'delete_webhook'; id?: string}) {
  const [state, action, pending] = useActionState(settingsAction, {} as SettingsState);
  const labels = {create_key: 'Create API key', create_webhook: 'Create webhook', revoke: 'Revoke', test_webhook: 'Send test event', disable_webhook: 'Disable webhook', enable_webhook: 'Enable webhook', delete_webhook: 'Delete webhook'};
  return <form action={action} className="space-y-3 rounded-xl border border-slate-200 p-4">
    <input type="hidden" name="action" value={kind}/>{id && <input type="hidden" name="id" value={id}/>}
    {kind === 'create_key' && <><label className="block">Key name<input className="block w-full rounded border p-2" name="name" required maxLength={80} placeholder="n8n production"/></label><fieldset><legend>Scopes</legend><p className="text-sm text-slate-700">Choose only what this workflow needs. The Postial n8n nodes need brands:read for brand/channel fields, posts:read for reads, posts:write for creating or changing posts, and webhooks:manage for the trigger.</p>{scopes.map(scope => <label key={scope} className="mr-4 inline-flex gap-2"><input type="checkbox" name="scope" value={scope} defaultChecked/><span><code>{scope}</code> — <span className="text-sm text-slate-700">{scopeHelp[scope]}</span></span></label>)}</fieldset></>}
    {kind === 'create_webhook' && <><label className="block">Endpoint URL<input className="block w-full rounded border p-2" name="url" type="url" required maxLength={2048} placeholder="https://example.com/webhooks/postial"/></label><fieldset><legend>Events</legend>{events.map(event => <label key={event} className="mr-4 inline-flex gap-2"><input type="checkbox" name="event" value={event} defaultChecked/>{event}</label>)}</fieldset></>}
    <button className="rounded bg-emerald-800 px-4 py-2 text-white disabled:opacity-50" disabled={pending}>{pending ? 'Saving…' : labels[kind]}</button>
    {state.error && <p role="alert" className="text-red-800">{state.error}</p>}
    {state.message && <p role="status">{state.message}</p>}
    {state.secret && <div className="space-y-2"><label className="block">API key — copy and save securely; it will not be shown again<input aria-label="One-time secret" readOnly value={state.secret} onFocus={e => e.target.select()} className="block w-full rounded border p-2 font-mono"/></label><button type="button" className="rounded border px-3 py-2" onClick={() => navigator.clipboard.writeText(state.secret!)} aria-label="Copy API key">Copy API key</button></div>}
  </form>;
}
