// Creates only an uncompleted Checkout, Portal session and temporary customer.
// Never follows the returned Stripe URLs or creates a subscription/payment.
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { users, sessions, subscriptions } from "../db/schema";
import { ensureWorkspace } from "../lib/workspaces";
import { stripe } from "../lib/stripe";
async function main() {
  const db = getDb(), client = stripe();
  const base = "http://localhost:3992";
  const userId = crypto.randomUUID(), token = crypto.randomUUID();
  let customerId: string | null = null, workspaceId: string | undefined;
  let stage = "setup";
  try {
    await db.insert(users).values({ id: userId, name: "SocialMint billing verification" });
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
    stage = "portal";
    const portal = await post("/api/stripe/portal"); assert.equal(portal.status, 200);
    assert.equal(new URL((await portal.json()).url).hostname, "billing.stripe.com");
    stage = "cross origin";
    assert.equal((await fetch(base + "/api/stripe/portal", { method: "POST", headers: { Cookie: cookie, Origin: "https://invalid.example" } })).status, 403);
    console.log("PASS LIVE checkout/portal: anonymous 401, protected page 307, owner 200 Stripe URLs, retry reuses Checkout, redirects correct, cross-origin 403. No checkout completed.");
  } finally {
    // Recover customer mapping even when an assertion failed after provisioning.
    if (!customerId && workspaceId) {
      const [row] = await db.select().from(subscriptions).where(eq(subscriptions.workspaceId, workspaceId));
      customerId = row?.stripeCustomerId ?? null;
      if (!customerId) {
        for await (const customer of client.customers.list({ limit: 100 })) {
          if (customer.metadata.workspace_id === workspaceId && customer.metadata.app === "socialmint") customerId = customer.id;
        }
      }
    }
    if (customerId) {
      const open = await client.checkout.sessions.list({ customer: customerId, status: "open" });
      for (const session of open.data) await client.checkout.sessions.expire(session.id);
      assert.equal((await client.customers.del(customerId)).deleted, true);
    }
    await db.delete(users).where(eq(users.id, userId));
    await db.$client.end();
    console.log("Cleanup completed; last stage:", stage);
  }
}
main().catch(() => { console.error("Billing verification failed (details suppressed to protect credentials)"); process.exitCode = 1; });
