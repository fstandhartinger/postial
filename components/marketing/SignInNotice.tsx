import { configuredProviders } from '@/lib/auth-providers';

export async function SignInNotice() {
  const providers = configuredProviders();
  if (providers.google || providers.email) return null;
  return <p className="note signin-notice">Sign-in opens shortly — try the interactive demo meanwhile</p>;
}
