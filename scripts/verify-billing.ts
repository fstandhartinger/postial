import './test-runtime';
import { installBillingMock } from './billing-mock';
import { deleteFixtureUsers } from './fixture-cleanup';
// Creates only an uncompleted Checkout, Portal session and temporary customer.
// Never follows the returned Stripe URLs or creates a subscription/payment.
import assert from "node:assert/strict";
import { eq, sql } from "drizzle-orm";
import { getDb } from "../db";
import { users, sessions, subscriptions, workspaces } from "../db/schema";
import { ensureWorkspace } from "../lib/workspaces";
import { checkoutTrial } from "../lib/checkout-trial";
import { internalPath, loginTarget } from "../lib/login-target";
import { billingRateLimit } from "../lib/rate-limit";
import { stripe } from "../lib/stripe";
async function main() {
  assert.equal(checkoutTrial(true, {}).subscription_data?.trial_period_days, 14);
  assert.equal(checkoutTrial(true, {}).subscription_data?.trial_settings?.end_behavior.missing_payment_method, 'cancel');
  assert.equal('trial_period_days' in checkoutTrial(false, {}).subscription_data!, false);
  assert.equal(checkoutTrial(false, {}).payment_method_collection, 'always');
  for (const invalid of ['https://invalid.example', '//invalid.example', '/%2fexample', '/\\example', '/a//b', '/%0aevil', '/%zz', [], undefined]) assert.equal(internalPath(invalid), undefined);
  assert.equal(loginTarget('/pricing', 'agency'), '/app/continue?next=%2Fpricing&plan=agency');
  assert.equal(loginTarget('/app/billing', 'invalid'), '/app/billing');
  assert.equal(loginTarget('//evil', {}), '/app');
  const limitKey = crypto.randomUUID();
  for (let i = 0; i < 5; i++) assert.equal(await billingRateLimit(limitKey), 0);
  assert.equal(await billingRateLimit(limitKey), 60);
  await getDb().execute(sql`update request_rate_limits set expires_at=now()-interval '1 second' where key=${'billing:'+limitKey}`);
  assert.equal(await billingRateLimit(limitKey), 0);
  await getDb().execute(sql`delete from request_rate_limits where key=${'billing:'+limitKey}`);
  const restoreFetch = await installBillingMock();
  const db = getDb(), client = stripe();
  const base = process.env.VERIFY_BASE_URL || process.env.BILLING_HTTP_URL || "http://localhost:3992";
  const userId = crypto.randomUUID(), token = crypto.randomUUID();
  let customerId: string | null = null, workspaceId: string | undefined;
  let stage = "setup";
  try {
    await db.insert(users).values({ id: userId, name: "Postial billing verification" });
    workspaceId = (await ensureWorkspace(userId)).id;
    await db.insert(sessions).values({ sessionToken: token, userId, expires: new Date(Date.now() + 600000) });
    const cookie = `authjs.session-token=${token}`;
    const post = (path: string, authenticated = true, body = { plan: "agency" }) => fetch(base + path, {
      method: "POST", headers: { Origin: base, "Content-Type": "application/json", ...(authenticated ? { Cookie: cookie } : {}) },
      body: JSON.stringify(body),
    });
    stage = "anonymous checkout";
    assert.equal((await post("/api/stripe/checkout", false)).status, 401);
    assert.equal((await fetch(base + "/api/stripe/checkout", { method: "POST" })).status, 401);
    assert.equal((await fetch(base + "/app/billing", { redirect: "manual" })).status, 307);
    stage = "billing no plan";
    const page = await fetch(base + "/app/billing", { headers: { Cookie: cookie } });
    assert.equal(page.status, 200); assert.match(await page.text(), /No plan yet/);
    const unconfirmed = await fetch(base + '/app?checkout=success', { headers: { Cookie: cookie } });
    assert.match(await unconfirmed.text(), /Checkout returned\. Your plan updates when payment confirmation/);
    const continuation = await fetch(base + '/app/continue?next=/pricing&plan=agency', { headers: { Cookie: cookie } });
    assert.equal(continuation.status, 200); assert.match(await continuation.text(), /Continue to checkout/);
    stage = "authenticated checkout";
    const checkout = await post("/api/stripe/checkout");
    assert.equal(checkout.status, 200);
    const data = await checkout.json();
    assert.equal(new URL(data.url).origin, "https://checkout.stripe.com");
    const [row] = await db.select().from(subscriptions).where(eq(subscriptions.workspaceId, workspaceId));
    customerId = row.stripeCustomerId; assert.ok(customerId);
    stage = "checkout retry";
    const again = await post("/api/stripe/checkout"); assert.equal(again.status, 200);
    assert.equal((await again.json()).url, data.url);
    const open = await client.checkout.sessions.list({ customer: customerId, status: "open" });
    assert.equal(open.data.length, 1);
    assert.equal(open.data[0].success_url, base + "/app?checkout=success&session_id={CHECKOUT_SESSION_ID}");
    assert.equal(open.data[0].cancel_url, base + "/pricing?checkout=cancelled");
    const first = await client.checkout.sessions.retrieve(open.data[0].id);
    assert.equal(first.metadata?.trial, 'true');
    assert.equal(first.payment_method_collection, 'if_required');
    assert.equal(first.subscription, null);
    stage = "paid restart";
    await client.checkout.sessions.expire(first.id);
    await db.update(workspaces).set({ trialUsedAt: new Date() }).where(eq(workspaces.id, workspaceId));
    await db.update(subscriptions).set({ stripeSubscriptionId: 'sub_fixture_ended_' + userId, status: 'canceled' }).where(eq(subscriptions.workspaceId, workspaceId));
    const restartPage = await fetch(base + '/app/billing', { headers: { Cookie: cookie } });
    assert.match(await restartPage.text(), /Restart plan/);
    const restart = await post('/api/stripe/checkout'); assert.equal(restart.status, 200);
    assert.equal(new URL((await restart.json()).url).origin, 'https://checkout.stripe.com');
    const restarted = await client.checkout.sessions.list({ customer: customerId, status: 'open' });
    assert.equal(restarted.data.length, 1);
    const paid = await client.checkout.sessions.retrieve(restarted.data[0].id);
    assert.equal(paid.metadata?.trial, 'false');
    assert.equal(paid.payment_method_collection, 'always');
    assert.equal(paid.subscription, null);
    // Stripe does not return subscription_data for an uncompleted Session.
    // Its absence alone cannot prove trial configuration; the request builder
    // above and retrieved payment_method_collection/metadata jointly verify it.
    assert.equal('subscription_data' in paid, false);
    stage = "portal";
    const portal = await post("/api/stripe/portal"); assert.equal(portal.status, 200);
    assert.equal(new URL((await portal.json()).url).hostname, "billing.stripe.com");
    stage = "cross origin";
    assert.equal((await fetch(base + "/api/stripe/portal", { method: "POST", headers: { Cookie: cookie, Origin: "https://invalid.example" } })).status, 403);
    stage = "rate limit";
    assert.equal((await post('/api/stripe/checkout')).status, 200);
    const limited = await post('/api/stripe/portal');
    assert.equal(limited.status, 429); assert.ok(Number(limited.headers.get('Retry-After')) > 0);
    console.log('PASS trial/restart: request trial 14/cancel vs absent, mocked SDK retrieve if_required vs always, trial metadata, canceled Restart plan, neutral banner, continuation page, shared 429/Retry-After, login whitelist and limiter reset');
    console.log("PASS mocked checkout/portal: anonymous 401, protected page 307, owner 200 Stripe URLs, retry reuses Checkout, redirects correct, cross-origin 403. No checkout completed.");
  } finally {
    // Recover customer mapping even when an assertion failed after provisioning.
    if (!customerId && workspaceId) {
      const [row] = await db.select().from(subscriptions).where(eq(subscriptions.workspaceId, workspaceId));
      customerId = row?.stripeCustomerId ?? null;
      if (!customerId) {
        const found = await client.customers.search({ query: `metadata['workspace_id']:'${workspaceId}' AND metadata['app']:'socialmint'`, limit: 2 });
        assert.ok(found.data.length <= 1); customerId = found.data[0]?.id ?? null;
      }
    }
    if (customerId) {
      const open = await client.checkout.sessions.list({ customer: customerId, status: "open" });
      for (const session of open.data) await client.checkout.sessions.expire(session.id);
      assert.equal((await client.customers.del(customerId)).deleted, true);
    }
    await deleteFixtureUsers(db).where(eq(users.id, userId));
    restoreFetch();
    await db.$client.end();
    console.log("Cleanup completed; last stage:", stage);
  }
}
main().catch(() => { console.error("Billing verification failed (details suppressed to protect credentials)"); process.exitCode = 1; });
