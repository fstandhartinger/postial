import { billingOwner, billingError, BillingHttpError, getSubscriptionForWorkspace } from '@/lib/billing';
import { stripe, appUrl, requiredEnv } from '@/lib/stripe';
import { portalSessionIdempotencyKey } from '@/lib/stripe-idempotency';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  try {
    const { workspace } = await billingOwner(request);
    const subscription = await getSubscriptionForWorkspace(workspace.id);
    if (!subscription?.stripeCustomerId) throw new BillingHttpError(404, 'Billing customer not found');
    const session = await stripe().billingPortal.sessions.create({ customer: subscription.stripeCustomerId, configuration: requiredEnv('STRIPE_PORTAL_CONFIG'), return_url: `${appUrl()}/app/billing` }, { idempotencyKey: portalSessionIdempotencyKey(workspace.id, subscription.stripeCustomerId) });
    return Response.json({ url: session.url });
  } catch (error) { return billingError(error); }
}
