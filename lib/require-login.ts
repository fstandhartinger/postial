import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { internalPath } from './login-target';
export async function requireLogin(): Promise<never> {
  const path = internalPath((await headers()).get('x-socialmint-path')) ?? '/app';
  redirect(`/login?${new URLSearchParams({ next: path })}`);
}
