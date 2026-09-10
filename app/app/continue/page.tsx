import { requireLogin } from '@/lib/require-login';
import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { isPlan } from '@/lib/plans';
import { internalPath } from '@/lib/login-target';
import { ContinueCheckout } from '@/components/billing/ContinueCheckout';
import { coreContext } from '@/lib/core';
import { getSubscriptionForWorkspace } from '@/lib/billing';
import { stripe } from '@/lib/stripe';
import { trialEligibility, type TrialEligibility } from '@/lib/trial-eligibility';
export default async function Continue({ searchParams }: { searchParams: Promise<{ next?: string; plan?: string }> }) {
  const params = await searchParams;
  const next = internalPath(params.next) ?? '/app';
  const plan = isPlan(params.plan) ? params.plan : undefined;
  const session = await auth();
  if (!session?.user?.id) return requireLogin();
  if (!plan) redirect(next);
  const { workspace } = await coreContext();
  const subscription = await getSubscriptionForWorkspace(workspace.id);
  let trialStatus: TrialEligibility = 'unknown';
  try {
    trialStatus = await trialEligibility({
      trialUsedAt: workspace.trialUsedAt,
      localStripeSubscriptionId: subscription?.stripeSubscriptionId,
      stripeCustomerId: subscription?.stripeCustomerId,
      workspaceId: workspace.id,
      client: stripe(),
    });
  } catch {
    // A billing-provider outage must never turn into a free-trial promise.
  }
  return <ContinueCheckout plan={plan} next={next} trialStatus={trialStatus} />;
}
