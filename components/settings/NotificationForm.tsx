"use client";
import {useActionState} from 'react';
import {notificationAction} from '@/app/app/settings/notifications/actions';
import {Button} from '@/components/ui/button';
export function NotificationForm({action,id,children}:{action:string;id?:string;children?:React.ReactNode}) {
  const [state,submit,pending]=useActionState(notificationAction,{message:''});
  return <form action={submit} className="space-y-3"><input type="hidden" name="action" value={action}/><input type="hidden" name="id" value={id??''}/>{children}<Button disabled={pending}>{pending?'Saving…':action==='create'?'Save destination':action==='test'?'Send test alert':action==='read'?'Mark read':'Delete destination'}</Button>{state.message && <p role="status">{state.message}</p>}</form>;
}
