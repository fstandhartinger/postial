import { randomUUID } from 'node:crypto';
import type Stripe from 'stripe';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { subscriptions, workspaces } from '@/db/schema';
import { billingState, stripeEvents } from '@/db/billing-schema';
import { stripe, requiredEnv } from '@/lib/stripe';
import { isPlan, plans, type Plan } from '@/lib/plans';
import { lockWorkspace } from '@/lib/billing';
export const runtime = 'nodejs';
function id(value: string | { id: string } | null | undefined): string | undefined {
  return typeof value === 'string' ? value : value?.id;
}
function subscriptionId(event: Stripe.Event): string | undefined {
  switch (event.type) {
    case 'checkout.session.completed': return id(event.data.object.subscription);
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': return event.data.object.id;
    case 'invoice.paid':
    case 'invoice.payment_failed': {
      const invoice = event.data.object;
      // Older account-default webhook versions used the top-level subscription field.
      const legacy = invoice as Stripe.Invoice & { subscription?: string | { id: string } | null };
      return id(invoice.parent?.subscription_details?.subscription) ?? id(legacy.subscription);
    }
    default: return undefined;
  }
}
async function resolvePlan(subscription: Stripe.Subscription): Promise<Plan> {
  if (subscription.items.data.length !== 1) throw new Error('Unexpected subscription items');
  const item = subscription.items.data[0]!;
  const price = await stripe().prices.retrieve(item.price.id);
  const plan = (Object.keys(plans) as Plan[]).find(p => plans[p].lookupKey === price.lookup_key);
  if (plan) return plan;
  if (isPlan(price.metadata.plan)) return price.metadata.plan;
  if (isPlan(subscription.metadata.plan)) return subscription.metadata.plan;
  throw new Error('Unknown SocialMint subscription plan');
}
async function reconcile(event: Stripe.Event, stripeSubscriptionId: string) {
  const preliminary = await stripe().subscriptions.retrieve(stripeSubscriptionId);
  const customerId = id(preliminary.customer)!;
  const [known] = await getDb().select().from(subscriptions).where(eq(subscriptions.stripeCustomerId, customerId)).limit(1);
  // A shared Stripe account also emits events belonging to other applications.
  if (!known && preliminary.metadata.app !== 'socialmint') return;
  const workspaceId = known?.workspaceId ?? preliminary.metadata.workspace_id;
  if (!workspaceId) throw new Error('Missing workspace mapping');
  await getDb().transaction(async tx => {
    await lockWorkspace(tx, workspaceId);
    const [seen] = await tx.select().from(stripeEvents).where(eq(stripeEvents.id, event.id));
    if (seen) return;
    // Fetch under the same lock as Checkout and persistence: late events cannot restore old status.
    const current = await stripe().subscriptions.retrieve(stripeSubscriptionId, { expand: ['latest_invoice'] });
    const [workspace] = await tx.select().from(workspaces).where(eq(workspaces.id, workspaceId));
    if (!workspace) throw new Error('Workspace not found');
    const [local] = await tx.select().from(subscriptions).where(eq(subscriptions.workspaceId, workspaceId));
    if (local?.stripeCustomerId && local.stripeCustomerId !== customerId) throw new Error('Customer mismatch');
    if (current.metadata.workspace_id && current.metadata.workspace_id !== workspaceId) throw new Error('Workspace mismatch');
    if (local?.stripeSubscriptionId && local.stripeSubscriptionId !== current.id) {
      // Never let a canceled previous subscription overwrite the replacement.
      if (!['canceled', 'incomplete_expired'].includes(current.status)) throw new Error('Multiple workspace subscriptions');
      await tx.insert(stripeEvents).values({ id: event.id }).onConflictDoNothing();
      return;
    }
    const plan = await resolvePlan(current);
    const [state] = await tx.select().from(billingState).where(eq(billingState.workspaceId, workspaceId));
    let pastDueSince: Date | null = null;
    if (current.status === 'past_due') {
      const invoice = typeof current.latest_invoice === 'object' ? current.latest_invoice : null;
      const began = invoice?.due_date ?? invoice?.status_transitions.finalized_at ?? invoice?.created;
      pastDueSince = state?.pastDueSince ?? new Date((began ?? Math.floor(Date.now() / 1000)) * 1000);
    }
    const values = {
      workspaceId, stripeCustomerId: customerId, stripeSubscriptionId: current.id, plan, status: current.status,
      trialEnd: current.trial_end ? new Date(current.trial_end * 1000) : null,
      currentPeriodEnd: new Date(current.items.data[0]!.current_period_end * 1000),
      cancelAtPeriodEnd: current.cancel_at_period_end, updatedAt: new Date(),
    };
    await tx.insert(subscriptions).values({ id: randomUUID(), ...values })
      .onConflictDoUpdate({ target: subscriptions.workspaceId, set: values });
    await tx.insert(billingState).values({ workspaceId, pastDueSince })
      .onConflictDoUpdate({ target: billingState.workspaceId, set: { pastDueSince } });
    await tx.insert(stripeEvents).values({ id: event.id }).onConflictDoNothing();
  });
}
export async function POST(request: Request) {
  const signature = request.headers.get('stripe-signature');
  if (!signature) return Response.json({ error: 'Missing signature' }, { status: 400 });
  let event: Stripe.Event;
  let secret: string;
  try { secret = requiredEnv('STRIPE_WEBHOOK_SECRET'); stripe(); }
  catch { return Response.json({ error: 'Webhook not configured' }, { status: 500 }); }
  const body = await request.text();
  try { event = stripe().webhooks.constructEvent(body, signature, secret); }
  catch { return Response.json({ error: 'Invalid signature' }, { status: 400 }); }
  try {
    const target = subscriptionId(event);
    if (target) await reconcile(event, target);
    return Response.json({ received: true });
  } catch {
    console.error('Stripe webhook reconciliation failed', { eventId: event.id, type: event.type });
    return Response.json({ error: 'Webhook processing failed' }, { status: 500 });
  }
}
