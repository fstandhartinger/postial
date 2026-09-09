'use client';
import { useActionState } from 'react';
export function SettingsForm({action,label,confirmation,operation,members}:{action:(state:{error:string},form:FormData)=>Promise<{error:string}>;label:string;confirmation?:string;operation?:string;members?:{id:string;name:string}[]}) {
  const [state,submit,pending] = useActionState(action,{error:''});
  return <form action={submit} className="space-y-3 rounded border p-4">
    {operation&&<input type="hidden" name="action" value={operation}/>}
    {confirmation&&<label className="block">Type <strong>{confirmation}</strong> to confirm<input required name="confirmation" autoComplete="off" className="mt-2 block w-full rounded border p-2"/></label>}
    {members&&<label className="block">New owner<select name="target" required className="ml-2 rounded border p-2">{members.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label>}
    {state.error&&<p role="alert" className="text-red-700">{state.error}</p>}
    <button disabled={pending||members?.length===0} className="rounded border px-4 py-2 font-semibold disabled:opacity-50">{pending?'Working…':label}</button>
  </form>;
}
