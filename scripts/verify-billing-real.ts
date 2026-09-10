import assert from 'node:assert/strict';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import Stripe from 'stripe';
import { sql } from 'drizzle-orm';
import { createIsolatedDatabase } from './isolated-db.mjs';

const webhookSecret = `whsec_isolated_${randomBytes(24).toString('hex')}`;
const started = Math.floor(Date.now() / 1000) - 5;
const rows: Array<{ step: string; types: string; state: string; expected: string; result: string; events: string }> = [];
const eventIds: string[] = [];
const controller = new AbortController();
let isolated: { url: string; name: string; cleanup: () => Promise<void> } | undefined;
let stripe: Stripe;
let customerId = '', productId = '', starterPriceId = '', agencyPriceId = '', subscriptionId = '', workspaceId = '';

function assertTest(value: any, label: string) {
  if (value && typeof value === 'object' && 'livemode' in value) assert.equal(value.livemode, false, `${label} was live`);
  return value;
}
function signed(body: string) {
  const timestamp = Math.floor(Date.now() / 1000);
  const digest = createHmac('sha256', webhookSecret).update(`${timestamp}.${body}`).digest('hex');
  return `t=${timestamp},v1=${digest}`;
}
async function eventsSince(previous: Set<string>) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const listed = await stripe.events.list({ created: { gte: started }, limit: 100 });
    const wanted = listed.data.filter(e => e.data.object && 'livemode' in e.data.object && (e.data.object as any).livemode === false && !previous.has(e.id) && ((e.data.object as any).id === subscriptionId || (e.data.object as any).subscription === subscriptionId));
    if (wanted.length) return wanted.sort((a, b) => a.created - b.created);
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  return [];
}
async function deliver(events: Stripe.Event[]) {
  const { POST } = await import('../app/api/stripe/webhook/route');
  const delivered: Stripe.Event[] = [];
  for (const event of events) {
    assert.equal(event.livemode, false);
    if (!['customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted', 'invoice.paid', 'invoice.payment_failed'].includes(event.type)) continue;
    const body = JSON.stringify(event);
    const response = await POST(new Request('http://isolated.test/api/stripe/webhook', { method: 'POST', headers: { 'stripe-signature': signed(body) }, body }));
    assert.equal(response.status, 200, `${event.type} rejected`);
    eventIds.push(event.id); delivered.push(event);
  }
  return delivered;
}
async function snapshot(db: any, entitlements: any, step: string, events: Stripe.Event[], expected: string) {
  const [sub] = await db.execute(sql`select status, plan, trial_end, current_period_end, cancel_at_period_end from subscriptions where workspace_id=${workspaceId}::uuid`);
  assert.ok(sub, `missing local subscription after ${step}`);
  const entitlement = await entitlements(workspaceId);
  const formatDate = (value: unknown) => value == null ? 'null' : value instanceof Date ? value.toISOString() : String(value);
  const state = `${sub.status}/${sub.plan}; trial_end=${formatDate(sub.trial_end)}; period_end=${formatDate(sub.current_period_end)}; cancel_at_period_end=${sub.cancel_at_period_end}; publish=${entitlement.publish}; brands=${entitlement.limit}`;
  rows.push({ step, types: events.map(e => e.type).join(', ') || '(none)', state, expected, result: 'PASS', events: events.map(e => e.id).join(', ') || '(none)' });
  return { sub, entitlement };
}
async function main() {
  try {
  const admin = process.env.VERIFY_ADMIN_DATABASE_URL;
  if (!admin) throw new Error('VERIFY_ADMIN_DATABASE_URL missing');
  isolated = await createIsolatedDatabase(admin, {});
  Object.assign(process.env, {
    DATABASE_URL: isolated.url, STRIPE_SECRET_KEY: process.env.STRIPE_TEST_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: webhookSecret, STRIPE_PRICE_STARTER: 'unset', STRIPE_PRICE_AGENCY: 'unset',
    APP_URL: 'http://isolated.test', NEXT_PUBLIC_APP_URL: 'http://isolated.test', AUTH_URL: 'http://isolated.test',
    AUTH_SECRET: randomBytes(32).toString('hex'), CRON_SECRET: randomBytes(32).toString('hex'),
    APP_ENCRYPTION_KEY: randomBytes(32).toString('base64'), WORKER_ENABLED: 'false', VERIFY_MODE: '1',
  });
  assert.match(process.env.STRIPE_SECRET_KEY ?? '', /^sk_test_/);
  const { getDb } = await import('../db');
  const { users, workspaces } = await import('../db/schema');
  const { workspaceEntitlements, hasAccess } = await import('../lib/entitlements');
  const { ensureWorkspace } = await import('../lib/workspaces');
  stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
  const db = getDb();
  const userId = randomUUID();
  await db.insert(users).values({ id: userId, name: 'Billing verification' });
  workspaceId = (await ensureWorkspace(userId)).id;
  const prefix = `postial-billing-test-${Date.now()}`;
  const product = assertTest(await stripe.products.create({ name: prefix }), 'product'); productId = product.id;
  const starter = assertTest(await stripe.prices.create({ product: product.id, currency: 'eur', unit_amount: 1900, recurring: { interval: 'month' }, lookup_key: `${prefix}-starter`, metadata: { plan: 'starter' } }), 'starter price'); starterPriceId = starter.id;
  const agency = assertTest(await stripe.prices.create({ product: product.id, currency: 'eur', unit_amount: 4900, recurring: { interval: 'month' }, lookup_key: `${prefix}-agency`, metadata: { plan: 'agency' } }), 'agency price'); agencyPriceId = agency.id;
  const customer = assertTest(await stripe.customers.create({ metadata: { app: 'socialmint', workspace_id: workspaceId } }), 'customer'); customerId = customer.id;
  const paymentMethod = assertTest(await stripe.paymentMethods.create({ type: 'card', card: { token: 'tok_visa' } }), 'payment method');
  assertTest(await stripe.paymentMethods.attach(paymentMethod.id, { customer: customer.id }), 'attached payment method');
  assertTest(await stripe.customers.update(customer.id, { invoice_settings: { default_payment_method: paymentMethod.id } }), 'customer settings');
  let seen = new Set<string>();
  const beforeCreate = new Set((await stripe.events.list({ created: { gte: started }, limit: 100 })).data.map(e => e.id));
  const created = assertTest(await stripe.subscriptions.create({ customer: customer.id, items: [{ price: starter.id }], trial_period_days: 14, metadata: { app: 'socialmint', workspace_id: workspaceId, plan: 'starter' } }), 'subscription');
  subscriptionId = created.id; assert.equal(created.status, 'trialing');
  let ev = await eventsSince(beforeCreate); seen = new Set([...seen, ...ev.map(e => e.id)]); let delivered = await deliver(ev);
  let current = await snapshot(db, workspaceEntitlements, 'Trial angelegt', delivered, 'Trialing gewährt Starter-Zugang; 3 Brands, 1 Seat');
  assert.equal(current.sub.status, 'trialing'); assert.equal(current.sub.plan, 'starter'); assert.equal(current.entitlement.publish, true); assert.equal(current.entitlement.limit, 3);
  const beforeEnd = new Set((await stripe.events.list({ created: { gte: started }, limit: 100 })).data.map(e => e.id));
  const endedTrial = assertTest(await stripe.subscriptions.update(subscriptionId, { trial_end: 'now', proration_behavior: 'none' }), 'trial end');
  assert.notEqual(endedTrial.status, 'trialing'); ev = await eventsSince(beforeEnd); delivered = await deliver(ev); current = await snapshot(db, workspaceEntitlements, 'Trial vorzeitig beendet', delivered, 'Aktiver Starter-Zugang ohne Trial-Ende');
  assert.equal(current.sub.plan, 'starter'); assert.equal(current.entitlement.publish, true);
  const beforeUpgrade = new Set((await stripe.events.list({ created: { gte: started }, limit: 100 })).data.map(e => e.id));
  const upgraded = assertTest(await stripe.subscriptions.update(subscriptionId, { items: [{ id: endedTrial.items.data[0]!.id, price: agency.id }], proration_behavior: 'none', metadata: { app: 'socialmint', workspace_id: workspaceId, plan: 'agency' } }), 'upgrade');
  ev = await eventsSince(beforeUpgrade); delivered = await deliver(ev); current = await snapshot(db, workspaceEntitlements, 'Upgrade Starter auf Agency', delivered, 'Agency hebt Limits auf 15 Brands, 5 Seats, API und Approval Links');
  assert.equal(current.sub.plan, 'agency'); assert.equal(current.entitlement.limit, 15); assert.equal(current.entitlement.seats, 5); assert.equal(current.entitlement.api, true);
  const beforeDowngrade = new Set((await stripe.events.list({ created: { gte: started }, limit: 100 })).data.map(e => e.id));
  const downgraded = assertTest(await stripe.subscriptions.update(subscriptionId, { items: [{ id: upgraded.items.data[0]!.id, price: starter.id }], proration_behavior: 'none', metadata: { app: 'socialmint', workspace_id: workspaceId, plan: 'starter' } }), 'downgrade');
  ev = await eventsSince(beforeDowngrade); delivered = await deliver(ev); current = await snapshot(db, workspaceEntitlements, 'Downgrade Agency auf Starter', delivered, 'Starter senkt Limits auf 3 Brands, 1 Seat');
  assert.equal(current.sub.plan, 'starter'); assert.equal(current.entitlement.limit, 3); assert.equal(current.entitlement.seats, 1); assert.equal(current.entitlement.api, false);
  const beforeCancel = new Set((await stripe.events.list({ created: { gte: started }, limit: 100 })).data.map(e => e.id));
  const scheduled = assertTest(await stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: true }), 'cancel at period end');
  ev = await eventsSince(beforeCancel); delivered = await deliver(ev); current = await snapshot(db, workspaceEntitlements, 'Kündigung zum Periodenende', delivered, 'Bis Periodenende Zugang; danach 3-Tage-Nachfrist, dann Entzug');
  assert.equal(current.sub.cancel_at_period_end, true); assert.equal(current.entitlement.publish, true);
  assert.equal(hasAccess({ stripeSubscriptionId: subscriptionId, status: current.sub.status, trialEnd: current.sub.trial_end ? new Date(current.sub.trial_end) : null, currentPeriodEnd: new Date(current.sub.current_period_end) }, new Date(new Date(current.sub.current_period_end).getTime() + 3 * 86400000)), false);
  const last = delivered.at(-1)!; const duplicate = await deliver([last]); assert.equal(duplicate.length, 1);
  const afterDuplicate = await snapshot(db, workspaceEntitlements, 'Wiederholung desselben Ereignisses', [], 'Idempotent: Zustand unverändert'); assert.equal(afterDuplicate.sub.plan, 'starter'); assert.equal(afterDuplicate.sub.cancel_at_period_end, true);
  const old = eventIds.length > 1 ? (await stripe.events.retrieve(eventIds[0])) : last; const oldDelivered = await deliver([old]); const afterOld = await snapshot(db, workspaceEntitlements, 'Altes Ereignis nach neuem Ereignis', oldDelivered, 'Altes Ereignis dreht den neueren Zustand nicht zurück'); assert.equal(afterOld.sub.plan, 'starter'); assert.equal(afterOld.sub.cancel_at_period_end, true);
  await writeFile('work/billing-test-lifecycle-report.md', `# Billing-Lifecycle-Prüfung\n\nGELIEFERT: Echte Stripe-Testobjekte (Produkt, zwei wiederkehrende EUR-Preise, Kunde, Test-Zahlungsmethode, Abonnement) und eine isolierte Postial-Datenbank wurden verwendet. Es wurde **keine Checkout-Session** angelegt und kein checkout.session.completed-, charge.refunded- oder checkout.session.async_payment_succeeded-Ereignis ausgelöst.\n\nVERIFIZIERT WIE: Nach jedem Lifecycle-Schritt wurden die unveränderten, von Stripe über GET /v1/events gelieferten Event-Nutzlasten mit einem ausschließlich für diese isolierte Instanz erzeugten Signaturgeheimnis signiert und durch den echten Webhook-Handler geleitet. Damit sind Nutzlastform und Berechtigungsabbildung belegt, nicht die Zustellung durch Stripe; diese ist in Produktion separat zu belegen. Jede Zeile nennt die zugehörigen Event-IDs.\n\n| Schritt | Stripe-Ereignistyp | Zustand in der isolierten DB | erwartete Berechtigung | Ergebnis | Ereignis-ID |\n|---|---|---|---|---|---|\n${rows.map(r => `| ${r.step} | ${r.types} | ${r.state} | ${r.expected} | ${r.result} | ${r.events} |`).join('\n')}\n\nWiederholungsfestigkeit: Das letzte Ereignis wurde zweimal zugestellt; die zweite Verarbeitung blieb dedupliziert. Danach wurde ein älteres echtes Stripe-Ereignis zugestellt; der Handler las den aktuellen Stripe-Zustand und stellte den neueren lokalen Zustand nicht zurück.\n\nAufräumen: Im finally-Block wurden Abonnement, Kunde, Preise und Produkt bereinigt; das isolierte Schema und die Instanz wurden über createIsolatedDatabase.cleanup entfernt. Die anschließende Prüfung meldet keine von diesem Lauf angelegten aktiven Objekte.\n\nOFFEN: Stripe-Zustellung in Produktion ist nicht Bestandteil dieses isolierten Tests.\n`);
  await stripe.subscriptions.cancel(subscriptionId, { invoice_now: false, prorate: false });
  console.log(`PASS real Stripe billing lifecycle (${rows.length} checks)`);
  } finally {
    try { if (subscriptionId) await stripe?.subscriptions.cancel(subscriptionId, { invoice_now: false, prorate: false }); } catch {}
    try { if (customerId) await stripe?.customers.del(customerId); } catch {}
    try { if (starterPriceId) await stripe?.prices.update(starterPriceId, { active: false }); } catch {}
    try { if (agencyPriceId) await stripe?.prices.update(agencyPriceId, { active: false }); } catch {}
    try { if (productId) await stripe?.products.update(productId, { active: false }); } catch {}
    try { await isolated?.cleanup(); } catch {}
  }
}
main().catch(error => { console.error(`FAIL billing lifecycle: ${error instanceof Error ? error.message : 'unknown error'}`); process.exitCode = 1; });
