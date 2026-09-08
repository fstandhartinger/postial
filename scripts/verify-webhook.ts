// Exercises the actual route over HTTP with real PostgreSQL and signed raw bodies.
// Stripe retrieval alone is mocked: no live subscription or payment is created.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { eq } from "drizzle-orm";
import type Stripe from "stripe";
import { getDb } from "../db";
import { users, workspaces, subscriptions } from "../db/schema";
import { billingState, stripeEvents } from "../db/billing-schema";
import { stripe, requiredEnv } from "../lib/stripe";
import { hasAccess } from "../lib/billing";
import { POST } from "../app/api/stripe/webhook/route";

async function main() {
  const db = getDb(), client = stripe();
  const userId = crypto.randomUUID(), workspaceId = crypto.randomUUID();
  const eventId = `evt_fixture_${crypto.randomUUID()}`;
  const subscriptionId = `sub_fixture_${crypto.randomUUID()}`;
  const customerId = `cus_fixture_${crypto.randomUUID()}`;
  const now = Math.floor(Date.now() / 1000);
  const fixture = {
    id: subscriptionId, object: "subscription", customer: customerId,
    metadata: { app: "socialmint", workspace_id: workspaceId, plan: "agency" },
    status: "trialing", trial_end: now + 14 * 86400, cancel_at_period_end: false,
    latest_invoice: null,
    items: { data: [{ price: { id: "price_fixture" }, current_period_end: now + 14 * 86400 }] },
  } as unknown as Stripe.Subscription;
  const retrieve = client.subscriptions.retrieve, priceRetrieve = client.prices.retrieve;
  client.subscriptions.retrieve = (async (id: string) => {
    assert.equal(id, subscriptionId); return fixture;
  }) as typeof retrieve;
  client.prices.retrieve = (async () => ({
    id: "price_fixture", lookup_key: "socialmint_agency_monthly", metadata: {},
  })) as unknown as typeof priceRetrieve;
  const server = createServer(async (req, res) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const response = await POST(new Request("http://localhost:3992/api/stripe/webhook", {
        method: "POST", headers: req.headers as Record<string, string>, body: Buffer.concat(chunks),
      }));
      res.writeHead(response.status, { "Content-Type": "application/json" });
      res.end(await response.text());
    } catch { res.writeHead(500); res.end(); }
  });
  try {
    await db.insert(users).values({ id: userId, name: "Webhook verification fixture" });
    await db.insert(workspaces).values({ id: workspaceId, ownerUserId: userId, name: "Webhook fixture", slug: `fixture-${workspaceId}` });
    server.listen(3992, "127.0.0.1"); await once(server, "listening");
    const payload = JSON.stringify({ id: eventId, object: "event", type: "customer.subscription.updated", created: now, data: { object: fixture } });
    async function post(body: string, signedBody = body) {
      const signature = client.webhooks.generateTestHeaderString({ payload: signedBody, secret: requiredEnv("STRIPE_WEBHOOK_SECRET") });
      return fetch("http://127.0.0.1:3992/api/stripe/webhook", { method: "POST", headers: { "stripe-signature": signature }, body });
    }
    assert.equal((await post(payload + " ", payload)).status, 400);
    assert.equal((await fetch("http://127.0.0.1:3992/api/stripe/webhook", { method: "POST", body: payload })).status, 400);
    assert.equal((await post(JSON.stringify({ id: "evt_unknown_fixture", type: "unknown.event", data: { object: {} } }))).status, 200);
    const results = await Promise.all([post(payload), post(payload)]);
    assert.deepEqual(results.map(r => r.status), [200, 200]);
    assert.equal((await post(payload)).status, 200);
    const rows = await db.select().from(subscriptions).where(eq(subscriptions.workspaceId, workspaceId));
    assert.equal(rows.length, 1); assert.equal(rows[0].plan, "agency");
    assert.equal(rows[0].status, "trialing"); assert.equal(rows[0].stripeSubscriptionId, subscriptionId);
    assert.equal((await db.select().from(stripeEvents).where(eq(stripeEvents.id, eventId))).length, 1);
    assert.ok(hasAccess(rows[0].status));
    assert.ok(hasAccess("past_due", new Date(Date.now() - 6 * 86400000)));
    assert.equal(hasAccess("past_due", new Date(0), new Date(7 * 86400000)), false);
    assert.equal(hasAccess("past_due"), false); assert.equal(hasAccess("canceled"), false);
    console.log("PASS webhook HTTP :3992: signed update 200, concurrent/repeated replay one row/event, invalid/missing signature 400, unknown event 200, access boundaries");
  } finally {
    client.subscriptions.retrieve = retrieve; client.prices.retrieve = priceRetrieve;
    if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await db.delete(stripeEvents).where(eq(stripeEvents.id, eventId));
    await db.delete(users).where(eq(users.id, userId));
    assert.equal((await db.select().from(billingState).where(eq(billingState.workspaceId, workspaceId))).length, 0);
    await db.$client.end();
  }
}
main().catch(() => { console.error("Webhook verification failed (details suppressed to protect credentials)"); process.exitCode = 1; });
