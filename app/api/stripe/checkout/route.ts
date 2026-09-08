import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { subscriptions } from '@/db/schema';
import { billingState } from '@/db/billing-schema';
import { billingOwner, billingError, BillingHttpError, lockWorkspace } from '@/lib/billing';
import { stripe, appUrl, requiredEnv } from '@/lib/stripe';
import { isPlan, plans } from '@/lib/plans';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  try {
    const { workspace, user } = await billingOwner(request);
    const body: unknown = await request.json().catch(() => null);
    const plan = body && typeof body === 'object' && 'plan' in body ? body.plan : null;
    if (!isPlan(plan)) throw new BillingHttpError(400, 'Invalid plan');
    const url = await getDb().transaction(async tx => {
      await lockWorkspace(tx, workspace.id);
      let [local] = await tx.select().from(subscriptions).where(eq(subscriptions.workspaceId, workspace.id)).limit(1);
      const metadata = { app: 'socialmint', user_id: user.id!, workspace_id: workspace.id };
      let customerId = local?.stripeCustomerId;
      if (!customerId) {
        // Recover if Stripe succeeded but a prior database transaction failed.
        let recovered: string | undefined;
        for await (const customer of stripe().customers.list({ limit: 100 })) {
          if (customer.metadata.app === 'socialmint' && customer.metadata.workspace_id === workspace.id) {
            if (recovered) throw new Error('Multiple workspace customers');
            recovered = customer.id;
          }
        }
        customerId = recovered ?? (await stripe().customers.create({ email: user.email ?? undefined, name: workspace.name, metadata }, { idempotencyKey: `socialmint-customer-${workspace.id}` })).id;
        [local] = await tx.insert(subscriptions).values({ id: randomUUID(), workspaceId: workspace.id, stripeCustomerId: customerId, plan, status: 'incomplete', updatedAt: new Date() })
          .onConflictDoUpdate({ target: subscriptions.workspaceId, set: { stripeCustomerId: customerId, updatedAt: new Date() } }).returning();
      }
      const existing = await stripe().subscriptions.list({ customer: customerId, status: 'all', limit: 100 });
      if (existing.data.some(s => !['canceled', 'incomplete_expired'].includes(s.status))) {
        throw new BillingHttpError(409, 'Subscription already exists; use the billing portal');
      }
      // Trials are available once per workspace, including after cancellation.
      if (existing.data.length || local?.stripeSubscriptionId) throw new BillingHttpError(409, 'Trial already used; contact support to reactivate');
      const open = await stripe().checkout.sessions.list({ customer: customerId, status: 'open', limit: 100 });
      const reusable = open.data.find(s => s.mode === 'subscription' && s.metadata?.app === 'socialmint' && s.metadata?.plan === plan && s.client_reference_id === workspace.id);
      if (reusable?.url) return reusable.url;
      for (const session of open.data) {
        if (session.mode === 'subscription' && session.metadata?.app === 'socialmint') await stripe().checkout.sessions.expire(session.id);
      }
      const [state] = await tx.select().from(billingState).where(eq(billingState.workspaceId, workspace.id));
      // Last session ID makes the retry key stable across DB rollbacks, yet permits a new checkout after expiry.
      const checkout = await stripe().checkout.sessions.create({
        mode: 'subscription', customer: customerId,
        line_items: [{ price: requiredEnv(plans[plan].priceEnv), quantity: 1 }],
        subscription_data: { trial_period_days: 14, metadata: { ...metadata, plan }, trial_settings: { end_behavior: { missing_payment_method: 'cancel' } } },
        metadata: { ...metadata, plan }, payment_method_collection: 'if_required', allow_promotion_codes: true,
        client_reference_id: workspace.id,
        success_url: `${appUrl()}/app?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${appUrl()}/pricing?checkout=cancelled`,
      }, { idempotencyKey: `socialmint-checkout-${workspace.id}-${plan}-${state?.checkoutSessionId ?? 'first'}` });
      if (!checkout.url || checkout.status !== 'open') throw new BillingHttpError(409, 'Checkout expired; please retry');
      await tx.insert(billingState).values({ workspaceId: workspace.id, checkoutSessionId: checkout.id, checkoutPlan: plan })
        .onConflictDoUpdate({ target: billingState.workspaceId, set: { checkoutSessionId: checkout.id, checkoutPlan: plan } });
      return checkout.url;
    });
    return Response.json({ url });
  } catch (error) { return billingError(error); }
}
