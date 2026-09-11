import { readBody, WEBHOOK_LIMIT } from '@/lib/http/body';
import { apiError } from '@/lib/api/errors';
import { randomUUID } from 'node:crypto';
import type Stripe from 'stripe';
import { eq, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { subscriptions, workspaces } from '@/db/schema';
import { billingState, stripeEvents, retiredSubscriptions } from '@/db/billing-schema';
import { stripe, requiredEnv } from '@/lib/stripe';
import { isPlan, plans, type Plan } from '@/lib/plans';
import { lockWorkspace } from '@/lib/billing';
import { recordFunnelEvent } from '@/lib/funnel';
import { recordError } from '@/lib/error-visibility';
import { sendSubscriptionReminder } from '@/lib/trial-reminder';
export const runtime = 'nodejs';
function id(value: string | { id: string } | null | undefined): string | undefined {
  return typeof value === 'string' ? value : value?.id;
}
function subscriptionId(event: Stripe.Event): string | undefined {
  switch (event.type) {
    case 'checkout.session.completed': return id(event.data.object.subscription);
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
    case 'customer.subscription.trial_will_end': return event.data.object.id;
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
/** True only for a trial that ran out with no payment method and no cancellation request. */
function lapsedWithoutPayment(subscription: Stripe.Subscription): boolean {
  if (!subscription.trial_end) return false;
  if (subscription.default_payment_method) return false;
  const reason = subscription.cancellation_details?.reason;
  if (reason === 'cancellation_requested') return false;
  return subscription.trial_end * 1000 <= Date.now() + 60_000;
}
async function resolvePlan(subscription: Stripe.Subscription): Promise<Plan> {
  if (subscription.items.data.length !== 1) throw new Error('Unexpected subscription items');
  const item = subscription.items.data[0]!;
  const price = await stripe().prices.retrieve(item.price.id);
  const plan = (Object.keys(plans) as Plan[]).find(p => plans[p].lookupKey === price.lookup_key);
  if (plan) return plan;
  if (isPlan(price.metadata.plan)) return price.metadata.plan;
  if (isPlan(subscription.metadata.plan)) return subscription.metadata.plan;
  throw new Error('Unknown Postial subscription plan');
}
async function reconcile(event: Stripe.Event, stripeSubscriptionId: string) {
  const preliminary = await stripe().subscriptions.retrieve(stripeSubscriptionId);
  const customerId = id(preliminary.customer)!;
  const [known] = await getDb().select().from(subscriptions).where(eq(subscriptions.stripeCustomerId, customerId)).limit(1);
  // A shared Stripe account also emits events belonging to other applications.
  if (!known && preliminary.metadata.app !== 'socialmint') return;
  const workspaceId = known?.workspaceId ?? preliminary.metadata.workspace_id;
  if (!workspaceId) throw new Error('Missing workspace mapping');
  // Optimistic revision check: retrieve Stripe outside the transaction; if any
  // concurrent writer changed this workspace, fetch again before applying it.
  for (let attempt = 0; attempt < 3; attempt++) {
    const [snapshot] = await getDb().select().from(subscriptions).where(eq(subscriptions.workspaceId, workspaceId));
    const current = await stripe().subscriptions.retrieve(stripeSubscriptionId, { expand: ['latest_invoice'] });
    const plan = await resolvePlan(current);
    const applied = await getDb().transaction(async tx => {
      await lockWorkspace(tx, workspaceId);
      const [seen] = await tx.select().from(stripeEvents).where(eq(stripeEvents.id, event.id));
      if (seen) return { applied: true, becameActive: false };
      const [workspace] = await tx.select().from(workspaces).where(eq(workspaces.id, workspaceId));
      const deleting = await tx.execute(sql`select 1 from workspace_deletions where workspace_id=${workspaceId}::uuid`);
      if (deleting.length) { await tx.insert(stripeEvents).values({id:event.id}).onConflictDoNothing(); return { applied: true, becameActive: false }; }
      if (!workspace) throw new Error('Workspace not found');
      const [local] = await tx.select().from(subscriptions).where(eq(subscriptions.workspaceId, workspaceId));
      if (local?.updatedAt.getTime() !== snapshot?.updatedAt.getTime() || local?.stripeSubscriptionId !== snapshot?.stripeSubscriptionId) return { applied: false, becameActive: false };
      if (local?.stripeCustomerId && local.stripeCustomerId !== customerId) throw new Error('Customer mismatch');
      if (current.metadata.workspace_id && current.metadata.workspace_id !== workspaceId) throw new Error('Workspace mismatch');
      const [retired] = await tx.select().from(retiredSubscriptions).where(eq(retiredSubscriptions.id, current.id));
      if (retired) {
        await tx.insert(stripeEvents).values({ id: event.id }).onConflictDoNothing();
        return { applied: true, becameActive: false };
      }
      if (local?.stripeSubscriptionId && local.stripeSubscriptionId !== current.id) {
        const ended = ['canceled', 'incomplete_expired', 'unpaid'];
        if (ended.includes(local.status) && ['active', 'trialing'].includes(current.status)) {
          await tx.insert(retiredSubscriptions).values({ id: local.stripeSubscriptionId, workspaceId }).onConflictDoNothing();
        } else {
          if (!ended.includes(current.status)) console.warn('Conflicting workspace subscriptions ignored');
          await tx.insert(stripeEvents).values({ id: event.id }).onConflictDoNothing();
          return { applied: true, becameActive: false };
        }
      }
      if (current.trial_start || current.trial_end) {
        if (!workspace.trialUsedAt) await tx.update(workspaces).set({ trialUsedAt: new Date() }).where(eq(workspaces.id, workspaceId));
      }
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
        // A strictly increasing revision also detects two writes in one millisecond.
        cancelAtPeriodEnd: current.cancel_at_period_end, updatedAt: new Date(Math.max(Date.now(), (local?.updatedAt.getTime() ?? 0) + 1)),
      };
      await tx.insert(subscriptions).values({ id: randomUUID(), ...values })
        .onConflictDoUpdate({ target: subscriptions.workspaceId, set: values });
      await tx.insert(billingState).values({ workspaceId, pastDueSince })
        .onConflictDoUpdate({ target: billingState.workspaceId, set: { pastDueSince } });
      await tx.insert(stripeEvents).values({ id: event.id }).onConflictDoNothing();
      return { applied: true, becameActive: !['active', 'trialing'].includes(local?.status ?? '') && ['active', 'trialing'].includes(current.status) };
    });
    if (applied.applied) { if (applied.becameActive) await recordFunnelEvent('subscription_active', { workspaceId }); return; }
  }
  throw new Error("Concurrent billing update; retry event");
}
export async function POST(request: Request) {
  let body: string;
  try { body = (await readBody(request, WEBHOOK_LIMIT)).toString('utf8'); }
  catch (e) { return apiError(e); }
  const signature = request.headers.get('stripe-signature');
  if (!signature) return Response.json({ error: 'Missing signature' }, { status: 400 });
  let event: Stripe.Event;
  let secret: string;
  try { secret = requiredEnv('STRIPE_WEBHOOK_SECRET'); stripe(); }
  catch { return Response.json({ error: 'Webhook not configured' }, { status: 500 }); }
  try { event = stripe().webhooks.constructEvent(body, signature, secret); }
  catch { return Response.json({ error: 'Invalid signature' }, { status: 400 }); }
  try {
    const target = subscriptionId(event);
    if (target) {
      await reconcile(event, target);
      if (event.type === 'customer.subscription.trial_will_end' || event.type === 'invoice.payment_failed') {
        await sendSubscriptionReminder(target, event.type === 'customer.subscription.trial_will_end' ? 'trial_will_end' : 'payment_failed');
      }
      // A card-less trial ends in silence otherwise: Stripe simply cancels, publishing stops
      // and the person hears nothing at the moment the consequence becomes real. The same
      // event fires when a paying customer deliberately cancels, and sending them a
      // win-back note would be tactless, so anything short of certainty stays quiet.
      // Until now the only mail a trial user ever got was a warning that it is ending.
      // Stripe sends nothing for a zero-amount trial, so the start was silent. One factual
      // notice, once per subscription through the same lock as the others.
      if (event.type === 'customer.subscription.created' && event.data.object.status === 'trialing') {
        await sendSubscriptionReminder(target, 'trial_started');
      }
      if (event.type === 'customer.subscription.deleted' && lapsedWithoutPayment(event.data.object)) {
        await sendSubscriptionReminder(target, 'trial_ended');
      }
    }
    return Response.json({ received: true });
  } catch (error) {
    void recordError(error, { route: '/api/stripe/webhook', status: 500, authenticated: false });
    return Response.json({ error: 'Webhook processing failed' }, { status: 500 });
  }
}
