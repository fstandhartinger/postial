import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:net';
import { once } from 'node:events';
import { eq, inArray } from 'drizzle-orm';
import type Stripe from 'stripe';
import { getDb } from '../db';
import { users, workspaces, subscriptions } from '../db/schema';
import { stripe, requiredEnv } from '../lib/stripe';
import { POST } from '../app/api/stripe/webhook/route';
import { subscriptionReminderEmails } from '../db/billing-schema';
import { subscriptionReminderContent } from '../lib/trial-reminder';
import { sendSubscriptionReminder } from '../lib/trial-reminder';

const db = getDb();
let client: Stripe;
const userId = crypto.randomUUID();
const workspaceId = crypto.randomUUID();
const failureUserId = crypto.randomUUID();
const failureWorkspaceId = crypto.randomUUID();
const subscriptionId = `sub_fixture_${crypto.randomUUID()}`;
const customerId = `cus_fixture_${crypto.randomUUID()}`;
const failedSubscriptionId = `sub_fixture_${crypto.randomUUID()}`;
const failedCustomerId = `cus_fixture_${crypto.randomUUID()}`;
const trialEnd = Math.floor(Date.now() / 1000) + 3 * 86400;
const messages: string[] = [];

function subscription(id: string, customer: string, status: 'trialing' | 'past_due', mappedWorkspaceId: string): Stripe.Subscription {
  return { id, object: 'subscription', customer, metadata: { app: 'socialmint', workspace_id: mappedWorkspaceId, plan: 'agency' }, status, trial_end: id === subscriptionId ? trialEnd : null, cancel_at_period_end: false, latest_invoice: null, items: { data: [{ price: { id: 'price_fixture' }, current_period_end: trialEnd + 30 * 86400 }] } } as unknown as Stripe.Subscription;
}

async function signed(event: Record<string, unknown>) {
  const payload = JSON.stringify(event);
  const signature = client.webhooks.generateTestHeaderString({ payload, secret: requiredEnv('STRIPE_WEBHOOK_SECRET') });
  return POST(new Request('http://localhost/api/stripe/webhook', { method: 'POST', headers: { 'stripe-signature': signature }, body: payload }));
}

async function expectOk(label: string, event: Record<string, unknown>) {
  const response = await signed(event);
  assert.equal(response.status, 200, `${label} webhook status`);
}

function smtpFixture(): Promise<{ server: Server; url: string }> {
  const server = createServer(socket => {
    let data = '';
    let inMessage = false;
    socket.write('220 fixture.local\r\n');
    socket.on('data', chunk => {
      data += chunk.toString();
      while (true) {
        if (inMessage) {
          const end = data.indexOf('\r\n.\r\n');
          if (end < 0) break;
          messages.push(data.slice(0, end));
          data = data.slice(end + 5);
          inMessage = false;
          socket.write('250 queued\r\n');
          continue;
        }
        const end = data.indexOf('\r\n');
        if (end < 0) break;
        const line = data.slice(0, end);
        data = data.slice(end + 2);
        if (/^EHLO|^HELO/i.test(line)) socket.write('250-fixture.local\r\n250 OK\r\n');
        else if (/^MAIL FROM|^RCPT TO/i.test(line)) socket.write('250 OK\r\n');
        else if (/^DATA/i.test(line)) { inMessage = true; socket.write('354 end with dot\r\n'); }
        else if (/^QUIT/i.test(line)) socket.write('221 bye\r\n');
      }
    });
  });
  server.listen(0, '127.0.0.1');
  return once(server, 'listening').then(() => ({ server, url: `smtp://127.0.0.1:${(server.address() as { port: number }).port}` }));
}


// A failed attempt must not silence the reminder forever: the reservation row is written
// before the send, so only a recorded delivery may block a later attempt.
async function verifyFailedAttemptRetry() {
  const retryId = `sub_fixture_${crypto.randomUUID()}`;
  await db.insert(subscriptionReminderEmails).values({ subscriptionId: retryId, kind: 'trial_will_end', error: 'earlier failure' });
  const [seeded] = await db.select().from(subscriptionReminderEmails).where(eq(subscriptionReminderEmails.subscriptionId, retryId));
  assert.equal(seeded.sentAt, null, 'a failed attempt leaves sent_at empty');
  const firstAttempt = seeded.attemptedAt.getTime();
  await new Promise(resolve => setTimeout(resolve, 5));
  await sendSubscriptionReminder(retryId, 'trial_will_end');
  const [after] = await db.select().from(subscriptionReminderEmails).where(eq(subscriptionReminderEmails.subscriptionId, retryId));
  assert.ok(after.attemptedAt.getTime() > firstAttempt, 'a failed reminder is attempted again instead of being skipped forever');
  await db.update(subscriptionReminderEmails).set({ sentAt: new Date() }).where(eq(subscriptionReminderEmails.subscriptionId, retryId));
  const [delivered] = await db.select().from(subscriptionReminderEmails).where(eq(subscriptionReminderEmails.subscriptionId, retryId));
  const deliveredAt = delivered.attemptedAt.getTime();
  await sendSubscriptionReminder(retryId, 'trial_will_end');
  const [again] = await db.select().from(subscriptionReminderEmails).where(eq(subscriptionReminderEmails.subscriptionId, retryId));
  assert.equal(again.attemptedAt.getTime(), deliveredAt, 'a delivered reminder is never attempted again');
  await db.delete(subscriptionReminderEmails).where(eq(subscriptionReminderEmails.subscriptionId, retryId));
  console.log('PASS trial reminder: failed attempt retried, delivered one never repeated');
}

async function main() {
  process.env.STRIPE_SECRET_KEY = 'sk_test_fixture';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_fixture';
  process.env.AUTH_URL = 'https://postial.co';
  process.env.NEXT_PUBLIC_APP_URL = 'https://postial.co';
  client = stripe();
  const fixtures = new Map<string, Stripe.Subscription>([
    [subscriptionId, subscription(subscriptionId, customerId, 'trialing', workspaceId)],
    [failedSubscriptionId, subscription(failedSubscriptionId, failedCustomerId, 'past_due', failureWorkspaceId)],
  ]);
  const originalRetrieve = client.subscriptions.retrieve;
  const originalPriceRetrieve = client.prices.retrieve;
  const smtp = await smtpFixture();
  client.subscriptions.retrieve = (async (id: string) => { const found = fixtures.get(id); assert.ok(found); return found; }) as typeof originalRetrieve;
  client.prices.retrieve = (async () => ({ id: 'price_fixture', lookup_key: 'socialmint_agency_monthly', metadata: {} })) as unknown as typeof originalPriceRetrieve;
  process.env.SMTP_URL = smtp.url;
  process.env.EMAIL_FROM = 'Postial <noreply@mail.postial.co>';
  process.env.NEXT_PUBLIC_APP_URL = 'https://postial.co';
  try {
    await db.insert(users).values({ id: userId, email: `trial-reminder-${userId}@example.invalid`, name: 'Trial reminder fixture' });
    await db.insert(workspaces).values({ id: workspaceId, ownerUserId: userId, name: 'Trial reminder fixture', slug: `trial-reminder-${workspaceId}` });
    await db.insert(users).values({ id: failureUserId, email: `trial-reminder-failure-${failureUserId}@example.invalid`, name: 'Trial reminder failure fixture' });
    await db.insert(workspaces).values({ id: failureWorkspaceId, ownerUserId: failureUserId, name: 'Trial reminder failure fixture', slug: `trial-reminder-failure-${failureWorkspaceId}` });
    const now = Math.floor(Date.now() / 1000);
    const trialEvent = { id: `evt_fixture_${crypto.randomUUID()}`, type: 'customer.subscription.trial_will_end', created: now, data: { object: { id: subscriptionId } } };
    await expectOk('trial first', trialEvent);
    await expectOk('trial replay', trialEvent);
    const failedEvent = { id: `evt_fixture_${crypto.randomUUID()}`, type: 'invoice.payment_failed', created: now, data: { object: { id: `in_fixture_${crypto.randomUUID()}`, subscription: failedSubscriptionId } } };
    await expectOk('payment first', failedEvent);
    await expectOk('payment replay', failedEvent);
    assert.equal(messages.length, 2);
    assert.match(messages[0]!, /trial ends on/);
    assert.match(messages[0]!, /https:\/\/postial\.co\/app\/billing/);
    assert.match(messages[1]!, /could not process the payment/);
    assert.equal((await db.select().from(subscriptionReminderEmails).where(eq(subscriptionReminderEmails.subscriptionId, subscriptionId))).length, 1);
    assert.equal((await db.select().from(subscriptionReminderEmails).where(eq(subscriptionReminderEmails.subscriptionId, failedSubscriptionId))).length, 1);
    const failureSubscriptionId = `sub_fixture_${crypto.randomUUID()}`;
    const failureCustomerId = `cus_fixture_${crypto.randomUUID()}`;
    fixtures.set(failureSubscriptionId, subscription(failureSubscriptionId, failureCustomerId, 'past_due', failureWorkspaceId));
    await db.delete(subscriptions).where(eq(subscriptions.workspaceId, failureWorkspaceId));
    const failureEvent = { id: `evt_fixture_${crypto.randomUUID()}`, type: 'invoice.payment_failed', created: now, data: { object: { id: `in_fixture_${crypto.randomUUID()}`, subscription: failureSubscriptionId } } };
    process.env.SMTP_URL = 'smtp://127.0.0.1:1';
    await expectOk('payment failure', failureEvent);
    const failedRow = await db.select().from(subscriptionReminderEmails).where(eq(subscriptionReminderEmails.subscriptionId, failureSubscriptionId));
    assert.equal(failedRow.length, 1);
    assert.ok(failedRow[0]!.error);
    await verifyFailedAttemptRetry();
    console.log('PASS trial reminders: both events mail once, replay deduplicated, failed delivery recorded with webhook 200, billing link/date present');
  } finally {
    client.subscriptions.retrieve = originalRetrieve;
    client.prices.retrieve = originalPriceRetrieve;
    await new Promise<void>((resolve, reject) => smtp.server.close(error => error ? reject(error) : resolve()));
    await db.delete(subscriptionReminderEmails).where(inArray(subscriptionReminderEmails.subscriptionId, [subscriptionId, failedSubscriptionId]));
    await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await db.delete(users).where(eq(users.id, userId));
    await db.delete(workspaces).where(eq(workspaces.id, failureWorkspaceId));
    await db.delete(users).where(eq(users.id, failureUserId));
    await db.$client.end();
  }
}

main().catch(error => { console.error('Trial reminder verification failed:', error instanceof Error ? error.message : 'unknown'); process.exitCode = 1; });

// A card-less trial that simply runs out must reach the owner, because publishing stops at
// that moment. The same Stripe event fires when a paying customer cancels on purpose, and a
// win-back note to them would be tactless, so the rule is strict and silence wins any doubt.
{
  const copy = subscriptionReminderContent('trial_ended', new Date('2026-09-23T12:09:00Z'));
  assert.match(copy.text, /nothing further will be published/);
  assert.match(copy.text, /do not go out on their own/, 'never promise that paused posts resume');
  assert.match(copy.text, /\/app\/billing/, 'the mail links to billing');
  assert.doesNotMatch(copy.subject, /payment could not/i);
  console.log('PASS trial reminder: the end of a card-less trial has its own honest notice');
}

// The start of a trial was the one transition without a word from us, so the whole mail
// relationship consisted of warnings. The notice must stay factual and must not claim that
// publishing works before a channel is connected.
{
  const copy = subscriptionReminderContent('trial_started', new Date('2026-09-23T12:09:00Z'));
  assert.match(copy.text, /running until/);
  assert.match(copy.text, /No card is needed/);
  assert.match(copy.text, /without connecting a channel/, 'say what works before a channel exists');
  assert.match(copy.text, /only when a post should actually go out/, 'and what needs one');
  assert.doesNotMatch(copy.text, /publish now|start publishing/i, 'never imply publishing works yet');
  console.log('PASS trial reminder: the start of a trial says what works without a channel');
}

// Every sentence of a notice must survive into the HTML that most mail clients display.
// The HTML used to render only the first block after the greeting, which silently dropped
// the actionable sentence from the trial-start notice on the day it shipped.
{
  for (const kind of ['trial_started', 'trial_ended', 'trial_will_end', 'payment_failed'] as const) {
    const copy = subscriptionReminderContent(kind, new Date('2026-09-23T12:09:00Z'));
    const blocks = copy.text.split('\n\n').slice(1, -2).filter(block => block.trim());
    assert.ok(blocks.length > 0, `${kind} has a body`);
    for (const block of blocks) {
      const needle = block.slice(0, 40).replaceAll('&', '&amp;');
      assert.ok(copy.html.includes(needle), `${kind}: the HTML drops "${block.slice(0, 40)}"`);
    }
  }
  console.log('PASS trial reminder: no notice loses a sentence in its HTML version');
}

// The button must lead where the text says. The trial-start notice pointed its text at the
// app and its button at billing, which would have sent someone who just started a card-free
// trial straight to a payment page as their first step.
{
  for (const kind of ['trial_started', 'trial_ended', 'trial_will_end', 'payment_failed'] as const) {
    const copy = subscriptionReminderContent(kind, new Date('2026-09-23T12:09:00Z'));
    const anchors = [...copy.html.matchAll(/<a href="([^"]*)"[^>]*>([^<]*)<\/a>/g)];
    assert.equal(anchors.length, 1, `${kind} offers exactly one link`);
    const inText = copy.text.match(/https:\/\/\S+/);
    assert.ok(inText, `${kind} names its link in the text too`);
    assert.equal(anchors[0]![1], inText![0], `${kind}: button and text must lead to the same place`);
    assert.ok(anchors[0]![2]!.trim().length > 0, `${kind} labels its button`);
  }
  console.log('PASS trial reminder: every notice leads to one place, and the button agrees with the text');
}
