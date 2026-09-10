import { readJson } from '@/lib/http/body';
import { ApiError, apiError } from '@/lib/api/errors';
import { checkoutTrial } from '@/lib/checkout-trial';
import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { subscriptions, workspaces } from '@/db/schema';
import { billingState } from '@/db/billing-schema';
import { billingOwner, billingError, BillingHttpError, lockWorkspace } from '@/lib/billing';
import { stripe, appUrl, requiredEnv } from '@/lib/stripe';
import { isPlan, plans } from '@/lib/plans';
import { recordFunnelEvent } from '@/lib/funnel';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  let release: (() => Promise<unknown>) | undefined;
  try {
    const { workspace, user } = await billingOwner(request);
    const body: unknown = await readJson(request);
    const plan = body && typeof body === 'object' && 'plan' in body ? body.plan : null;
    if (!isPlan(plan)) throw new BillingHttpError(400, 'Invalid plan');
    const price = requiredEnv(plans[plan].priceEnv);
    const client = stripe(), db = getDb();
    // A persistent lease serializes provisioning across processes without holding a
    // transaction/connection during Stripe I/O. An abandoned lease expires.
    const lease = randomUUID();
    await db.transaction(async tx => {
      await lockWorkspace(tx, workspace.id);
      const deleting = await tx.execute(sql`select 1 from workspace_deletions where workspace_id=${workspace.id}::uuid`);
      if (deleting.length) throw new BillingHttpError(409,'Workspace deletion is in progress.');
      const [state] = await tx.select().from(billingState).where(eq(billingState.workspaceId, workspace.id));
      if (state?.checkoutLeaseUntil && state.checkoutLeaseUntil > new Date()) throw new BillingHttpError(409, 'Checkout is already opening; retry shortly', 5);
      const values = { checkoutLease: lease, checkoutLeaseUntil: new Date(Date.now() + 10 * 60_000) };
      await tx.insert(billingState).values({ workspaceId: workspace.id, ...values })
        .onConflictDoUpdate({ target: billingState.workspaceId, set: values });
    });
    release = () => db.update(billingState).set({ checkoutLease: null, checkoutLeaseUntil: null })
      .where(and(eq(billingState.workspaceId, workspace.id), eq(billingState.checkoutLease, lease)));
    let [local] = await db.select().from(subscriptions).where(eq(subscriptions.workspaceId, workspace.id));
    const metadata = { app: 'socialmint', user_id: user.id!, workspace_id: workspace.id };
    let customerId = local?.stripeCustomerId;
    if (!customerId) {
      const recovered = await client.customers.search({ query: `metadata['workspace_id']:'${workspace.id}' AND metadata['app']:'socialmint'`, limit: 2 });
      if (recovered.data.length > 1) throw new Error('Multiple workspace customers');
      customerId = recovered.data[0]?.id ?? (await client.customers.create({ email: user.email ?? undefined, name: workspace.name, metadata }, { idempotencyKey: `socialmint-customer-${workspace.id}` })).id;
      // Persist immediately, before any Checkout call, to survive partial failure.
      [local] = await db.insert(subscriptions).values({ id: randomUUID(), workspaceId: workspace.id, stripeCustomerId: customerId, plan, status: 'incomplete', updatedAt: new Date() })
        .onConflictDoUpdate({ target: subscriptions.workspaceId, set: { stripeCustomerId: customerId, updatedAt: new Date() } }).returning();
    }
    const existing = await client.subscriptions.list({ customer: customerId, status: 'all', limit: 100 });
    if (existing.has_more || existing.data.some(s => !['canceled', 'incomplete_expired', 'unpaid'].includes(s.status))) {
      throw new BillingHttpError(409, 'Subscription already exists; use the billing portal');
    }
    const [fresh] = await db.select().from(workspaces).where(eq(workspaces.id, workspace.id));
    const trial = !fresh.trialUsedAt && !existing.data.length && !local?.stripeSubscriptionId;
    if (!trial && !fresh.trialUsedAt) await db.update(workspaces).set({ trialUsedAt: new Date() }).where(eq(workspaces.id, workspace.id));
    const open = await client.checkout.sessions.list({ customer: customerId, status: 'open', limit: 100 });
    const reusable = open.data.find(s => s.mode === 'subscription' && s.metadata?.app === 'socialmint' && s.metadata?.plan === plan && s.metadata?.trial === String(trial) && s.client_reference_id === workspace.id);
    if (reusable?.url) return Response.json({ url: reusable.url });
    for (const session of open.data) {
      if (session.mode === 'subscription' && session.metadata?.app === 'socialmint') await client.checkout.sessions.expire(session.id);
    }
    const [state] = await db.select().from(billingState).where(eq(billingState.workspaceId, workspace.id));
    const checkout = await client.checkout.sessions.create({
      mode: 'subscription', customer: customerId,
      line_items: [{ price, quantity: 1 }],
      ...checkoutTrial(trial, { ...metadata, plan }),
      metadata: { ...metadata, plan, trial: String(trial) }, allow_promotion_codes: true,
      custom_text: { submit: { message: 'Postial social publishing subscription.' } },
      client_reference_id: workspace.id,
      success_url: `${appUrl()}/app?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl()}/pricing?checkout=cancelled`,
    }, { idempotencyKey: `socialmint-checkout-${workspace.id}-${plan}-${trial}-${state?.checkoutSessionId ?? 'first'}` });
    if (!checkout.url || checkout.status !== 'open') throw new BillingHttpError(409, 'Checkout expired; please retry');
    await db.update(billingState).set({ checkoutSessionId: checkout.id, checkoutPlan: plan }).where(eq(billingState.workspaceId, workspace.id));
    await recordFunnelEvent('checkout_started', { workspaceId: workspace.id });
    return Response.json({ url: checkout.url });
  } catch (error) { return error instanceof ApiError ? apiError(error) : billingError(error); }
  finally { if (release) { try { await release(); } catch { console.error('Checkout lease cleanup failed; lease will expire'); } } }
}
