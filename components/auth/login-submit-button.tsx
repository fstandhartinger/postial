'use client';

import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';

export function LoginSubmitButton({ method, disabled = false }: { method: 'google' | 'email'; disabled?: boolean }) {
  const { pending } = useFormStatus();
  const label = method === 'google' ? 'Continue with Google' : 'Send magic link';
  return <Button type="submit" disabled={disabled || pending}>{pending ? (method === 'google' ? 'Opening Google…' : 'Sending magic link…') : label}</Button>;
}
