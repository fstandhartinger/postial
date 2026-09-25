import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:net';
import { once } from 'node:events';
import { eq, inArray } from 'drizzle-orm';
import type Stripe from 'stripe';
import { getDb } from '../db';
import { users, workspaces, subscriptions, errorEvents } from '../db/schema';
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
const foreignSubscriptionId = `sub_fixture_${crypto.randomUUID()}`;
const foreignCustomerId = `cus_fixture_${crypto.randomUUID()}`;
const unknownSubscriptionId = `sub_fixture_${crypto.randomUUID()}`;
const retryUserId = crypto.randomUUID();
const retryWorkspaceId = crypto.randomUUID();
const retrySubscriptionId = `sub_fixture_${crypto.randomUUID()}`;
const nullEmailUserId = crypto.randomUUID();
const nullEmailWorkspaceId = crypto.randomUUID();
const nullEmailSubscriptionId = `sub_fixture_${crypto.randomUUID()}`;
const trialEnd = Math.floor(Date.now() / 1000) + 3 * 86400;
const messages: string[] = [];

function subscription(id: string, customer: string, status: 'trialing' | 'past_due', mappedWorkspaceId: string, app = 'socialmint'): Stripe.Subscription {
  return { id, object: 'subscription', customer, metadata: { app, workspace_id: mappedWorkspaceId, plan: 'agency' }, status, trial_end: id === subscriptionId ? trialEnd : null, cancel_at_period_end: false, latest_invoice: null, items: { data: [{ price: { id: 'price_fixture' }, current_period_end: trialEnd + 30 * 86400 }] } } as unknown as Stripe.Subscription;
}

function localSubscription(workspaceId: string, stripeSubscriptionId: string) {
  return { id: crypto.randomUUID(), workspaceId, stripeSubscriptionId, plan: 'agency' as const, status: 'trialing', trialEnd: new Date(trialEnd * 1000), currentPeriodEnd: new Date((trialEnd + 30 * 86400) * 1000), updatedAt: new Date() };
}

async function subscriptionReminderErrorCount(): Promise<number> {
  const rows = await db.select({ id: errorEvents.id }).from(errorEvents).where(eq(errorEvents.route, 'stripe:subscription-reminder'));
  return rows.length;
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
  const retryId = retrySubscriptionId;
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
    [foreignSubscriptionId, subscription(foreignSubscriptionId, foreignCustomerId, 'trialing', crypto.randomUUID(), 'wissen')],
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
    // The retry case is a genuine local subscription now that the reminder is a skip without
    // a local row, so it needs the workspace/user/subscription the join reads.
    await db.insert(users).values({ id: retryUserId, email: `trial-reminder-retry-${retryUserId}@example.invalid`, name: 'Trial reminder retry fixture' });
    await db.insert(workspaces).values({ id: retryWorkspaceId, ownerUserId: retryUserId, name: 'Trial reminder retry fixture', slug: `trial-reminder-retry-${retryWorkspaceId}` });
    await db.insert(subscriptions).values(localSubscription(retryWorkspaceId, retrySubscriptionId));
    const now = Math.floor(Date.now() / 1000);
    const trialEvent = { id: `evt_fixture_${crypto.randomUUID()}`, type: 'customer.subscription.trial_will_end', created: now, data: { object: { id: subscriptionId } } };
    await expectOk('trial first', trialEvent);
    await expectOk('trial replay', trialEvent);
    const failedEvent = { id: `evt_fixture_${crypto.randomUUID()}`, type: 'invoice.payment_failed', created: now, data: { object: { id: `in_fixture_${crypto.randomUUID()}`, subscription: failedSubscriptionId } } };
    await expectOk('payment first', failedEvent);
    await expectOk('payment replay', failedEvent);
    assert.equal(messages.length, 2);
    assert.match(messages[0]!, /trial ends on/);
    // Decode quoted-printable before asserting: the transfer encoding inserts soft line
    // breaks, so a longer subject can split the URL mid-string even though every mail client
    // reassembles it. Assert what the recipient sees, not how it happened to be encoded.
    const decoded = messages[0]!.replaceAll('=\r\n', '').replaceAll('=\n', '');
    assert.match(decoded, /https:\/\/postial\.co\/app\/billing/);
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

    // AT1: a sibling venture's subscription event (metadata.app != socialmint, no local row)
    // arrives on the shared Stripe account. It must be a quiet no-op on every axis.
    {
      const foreignEvent = { id: `evt_fixture_${crypto.randomUUID()}`, type: 'customer.subscription.trial_will_end', created: now, data: { object: { id: foreignSubscriptionId } } };
      const rowsBefore = (await db.select().from(subscriptionReminderEmails).where(eq(subscriptionReminderEmails.subscriptionId, foreignSubscriptionId))).length;
      const errorsBefore = await subscriptionReminderErrorCount();
      const mailsBefore = messages.length;
      await expectOk('foreign trial_will_end', foreignEvent);
      const rowsAfter = (await db.select().from(subscriptionReminderEmails).where(eq(subscriptionReminderEmails.subscriptionId, foreignSubscriptionId))).length;
      assert.equal(rowsBefore, 0, 'a foreign subscription has no reminder rows before the event');
      assert.equal(rowsAfter, 0, 'a foreign webhook leaves no reminder rows behind');
      assert.equal(await subscriptionReminderErrorCount(), errorsBefore, 'a foreign webhook adds no subscription-reminder error event');
      assert.equal(messages.length, mailsBefore, 'a foreign webhook sends no mail');
      console.log('PASS trial reminder: a foreign subscription webhook is a quiet no-op (200, no rows, no error event, no mail)');
    }

    // AT2: called directly for an id with no local row, the reminder is a quiet skip that
    // logs the exact structured reason instead of reserving or throwing.
    {
      const captured: string[] = [];
      const originalInfo = console.info;
      console.info = (...args: unknown[]) => { captured.push(args.map(arg => String(arg)).join(' ')); };
      const errorsBefore = await subscriptionReminderErrorCount();
      try {
        await sendSubscriptionReminder(unknownSubscriptionId, 'trial_will_end');
      } finally {
        console.info = originalInfo;
      }
      assert.equal((await db.select().from(subscriptionReminderEmails).where(eq(subscriptionReminderEmails.subscriptionId, unknownSubscriptionId))).length, 0, 'a direct unknown-subscription call inserts no reminder row');
      assert.equal(await subscriptionReminderErrorCount(), errorsBefore, 'a direct unknown-subscription call adds no subscription-reminder error event');
      const skip = captured
        .map(line => { try { return JSON.parse(line) as Record<string, unknown>; } catch { return undefined; } })
        .find(entry => entry?.event === 'subscription_reminder_skipped');
      assert.ok(skip, 'a direct unknown-subscription call logs a subscription_reminder_skipped line');
      assert.equal(skip!.reason, 'unknown_subscription', 'the skip line names the unknown_subscription reason');
      console.log('PASS trial reminder: a direct unknown-subscription call skips quietly with the structured reason');
    }

    // AT4: a local subscription row EXISTS but its owner email join yields no email. That is
    // a genuine data-integrity defect, so it must stay an error, not widen into a skip.
    {
      await db.insert(users).values({ id: nullEmailUserId, email: null, name: 'Trial reminder null email fixture' });
      await db.insert(workspaces).values({ id: nullEmailWorkspaceId, ownerUserId: nullEmailUserId, name: 'Trial reminder null email fixture', slug: `trial-reminder-null-email-${nullEmailWorkspaceId}` });
      await db.insert(subscriptions).values(localSubscription(nullEmailWorkspaceId, nullEmailSubscriptionId));
      const errorsBefore = await subscriptionReminderErrorCount();
      const mailsBefore = messages.length;
      await sendSubscriptionReminder(nullEmailSubscriptionId, 'trial_will_end');
      const [row] = await db.select().from(subscriptionReminderEmails).where(eq(subscriptionReminderEmails.subscriptionId, nullEmailSubscriptionId));
      assert.ok(row, 'a local subscription still writes its reservation row');
      assert.ok(row!.error, 'a local subscription without an owner email records an error, never a skip');
      assert.equal(await subscriptionReminderErrorCount(), errorsBefore + 1, 'a local subscription without an owner email adds an error event');
      assert.equal(messages.length, mailsBefore, 'no mail is sent without an owner email');
      console.log('PASS trial reminder: a local subscription with no owner email stays an error, never a skip');
    }
  } finally {
    client.subscriptions.retrieve = originalRetrieve;
    client.prices.retrieve = originalPriceRetrieve;
    await new Promise<void>((resolve, reject) => smtp.server.close(error => error ? reject(error) : resolve()));
    await db.delete(subscriptionReminderEmails).where(inArray(subscriptionReminderEmails.subscriptionId, [subscriptionId, failedSubscriptionId, foreignSubscriptionId, retrySubscriptionId, nullEmailSubscriptionId]));
    await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await db.delete(users).where(eq(users.id, userId));
    await db.delete(workspaces).where(eq(workspaces.id, failureWorkspaceId));
    await db.delete(users).where(eq(users.id, failureUserId));
    await db.delete(workspaces).where(eq(workspaces.id, retryWorkspaceId));
    await db.delete(users).where(eq(users.id, retryUserId));
    await db.delete(workspaces).where(eq(workspaces.id, nullEmailWorkspaceId));
    await db.delete(users).where(eq(users.id, nullEmailUserId));
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

// A notice must remain usable when the button does not render. The sign-in mail has always
// shown the full link as text beside its button; the notices did not, so a client that
// strips anchors left the recipient with nothing to click and no address to copy.
{
  for (const kind of ['trial_started', 'trial_ended', 'trial_will_end', 'payment_failed'] as const) {
    const copy = subscriptionReminderContent(kind, new Date('2026-09-23T12:09:00Z'));
    const url = copy.text.match(/https:\/\/\S+/)![0];
    assert.ok(copy.html.includes(`<code>${url}</code>`), `${kind} shows the full link as text as well`);
    assert.match(copy.html, /If the button does not work/, `${kind} says why the plain link is there`);
  }
  console.log('PASS trial reminder: every notice survives a client that drops the button');
}

// Name the workspace. A person can own several, and "your trial has ended" alone does not
// say which one stopped publishing. The name comes from the customer, so it must never
// reach the HTML unescaped, and an absent name must not leave a dangling preposition.
{
  const hostile = 'Acme <script>alert(1)</script> & Co';
  for (const kind of ['trial_started', 'trial_ended', 'trial_will_end', 'payment_failed'] as const) {
    const named = subscriptionReminderContent(kind, new Date('2026-09-23T12:09:00Z'), hostile);
    assert.match(named.subject, /Acme/, `${kind} names the workspace`);
    assert.ok(!named.html.includes('<script>'), `${kind} escapes the name in the HTML`);
    const plain = subscriptionReminderContent(kind, new Date('2026-09-23T12:09:00Z'));
    assert.ok(!/ for\s*$/.test(plain.subject) && !plain.subject.includes(' for  '), `${kind} reads correctly without a name`);
  }
  const long = subscriptionReminderContent('trial_ended', null, 'x'.repeat(200));
  assert.ok(long.subject.length < 120, 'a very long workspace name cannot bloat the subject');
  console.log('PASS trial reminder: each notice names its workspace, escaped and bounded');
}
