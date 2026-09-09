'use client';
import { useActionState } from 'react';
import { joinAction } from '@/app/join/[token]/actions';
import { Button } from '@/components/ui/button';
export function JoinForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(joinAction.bind(null, token), {});
  return <form action={action}><Button disabled={pending}>Join workspace</Button>{state.error && <p role="alert" className="mt-3 text-red-700">{state.error}</p>}</form>;
}
