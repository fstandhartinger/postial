'use client';
import { useActionState, useState } from 'react';
import { teamAction } from '@/app/app/settings/team/actions';
import { Button } from '@/components/ui/button';
export function TeamForm({ action, target, role = 'editor', disabled = false }: { action: string; target?: string; role?: string; disabled?: boolean }) {
  const [state, submit, pending] = useActionState(teamAction, {});
  const [copied, setCopied] = useState(false);
  return <form action={submit} className="flex flex-wrap items-center gap-3">
    <input type="hidden" name="action" value={action}/><input type="hidden" name="target" value={target ?? ''}/>
    {action === 'create' && <input aria-label="Invite email" required type="email" name="email" placeholder="person@example.com" className="rounded border p-2"/>}
    {(action === 'create' || action === 'role') && <select aria-label="Role" name="role" defaultValue={role} className="rounded border p-2"><option value="editor">Editor</option><option value="owner">Owner</option></select>}
    <Button disabled={disabled || pending} variant="secondary">{action === 'create' ? 'Create invite link' : action === 'role' ? 'Save role' : action === 'remove' ? 'Remove member' : 'Revoke invite'}</Button>
    {state.error && <p role="alert" className="w-full text-red-700">{state.error}</p>}{state.message && <p role="status">{state.message}</p>}
    {state.link && <div className="w-full min-w-0 space-y-2 rounded bg-emerald-50 p-3"><p>Copy this link now. It will not be shown again. Only the invited email address can join. Expires in 7 days.</p><input aria-label="Invite link" readOnly value={state.link} className="w-full rounded border p-2"/><Button type="button" onClick={async () => { try { await navigator.clipboard.writeText(state.link!); setCopied(true); } catch { setCopied(false); } }}>{copied ? 'Copied' : 'Copy'}</Button></div>}
  </form>;
}
