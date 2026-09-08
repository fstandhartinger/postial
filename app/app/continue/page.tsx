import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { isPlan } from '@/lib/plans';
import { internalPath } from '@/lib/login-target';
import { ContinueCheckout } from '@/components/billing/ContinueCheckout';
export default async function Continue({ searchParams }: { searchParams: Promise<{ next?: string; plan?: string }> }) {
  const params = await searchParams;
  const next = internalPath(params.next) ?? '/app';
  const plan = isPlan(params.plan) ? params.plan : undefined;
  const session = await auth();
  if (!session?.user?.id) redirect(`/login?${new URLSearchParams({ next, ...(plan ? { plan } : {}) })}`);
  if (!plan) redirect(next);
  return <ContinueCheckout plan={plan} next={next} />;
}
