import { configuredProviders } from '@/lib/auth-providers';
import { connection } from 'next/server';

export async function SignInNotice() {
  await connection();
  const providers = configuredProviders();
  if (providers.google || providers.email) return null;
  return <p className="note signin-notice">Sign-in opens shortly — try the interactive demo meanwhile</p>;
}
