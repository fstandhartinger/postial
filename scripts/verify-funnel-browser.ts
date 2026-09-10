import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { eq, desc } from 'drizzle-orm';
import { chromium } from 'playwright';
import { getDb } from '../db';
import { funnelEvents, verificationTokens, subscriptions, posts, postTargets } from '../db/schema';
import { normalizeEmail } from '../lib/auth-email';
import { registerPublisher } from '../lib/publishers';
import { tick } from '../lib/publishing';

const base = process.env.VERIFY_BASE_URL!;
const db = getDb();
const journey = ['landing_view','pricing_view','signup_started','signup_completed','workspace_created','channel_connected','post_scheduled','post_published'];

async function counts() {
  const rows = await db.select({ event: funnelEvents.event }).from(funnelEvents);
  return Object.fromEntries(journey.map(e => [e, rows.filter(r => r.event === e).length]));
}

test('browser funnel journey records each stage exactly once', async () => {
  const email = `funnel-${crypto.randomUUID()}@example.invalid`;
  const before = await counts();
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(base); await page.waitForLoadState('networkidle');
    await page.goto(base + '/pricing'); await page.waitForLoadState('networkidle');
    assert.equal((await counts()).landing_view - before.landing_view, 1);
    assert.equal((await counts()).pricing_view - before.pricing_view, 1);
    await page.goto(base + '/login');
    await page.getByLabel('Email').fill(email);
    await Promise.all([page.waitForURL(/\/login(?:\/check-email|\?error)/), page.getByRole('button', { name: /magic link/i }).click()]);
    assert.equal((await counts()).signup_started - before.signup_started, 1);
    // The local SMTP sink is intentionally disabled; this fixture represents the link delivered by the provider.
    const rawToken = crypto.randomUUID();
    await db.insert(verificationTokens).values({ identifier: normalizeEmail(email), token: createHash('sha256').update(rawToken + process.env.AUTH_SECRET!).digest('hex'), expires: new Date(Date.now() + 60000) });
    await page.goto(`${base}/api/auth/callback/nodemailer?token=${rawToken}&email=${encodeURIComponent(email)}&callbackUrl=${encodeURIComponent(base + '/app')}`);
    await page.waitForURL(/\/app/);
    const afterLogin = await counts();
    assert.equal(afterLogin.signup_completed - before.signup_completed, 1);
    assert.equal(afterLogin.workspace_created - before.workspace_created, 1);
    // The isolated verifier has no billing provider; grant this fixture publish access only.
    const wsEvent = (await db.select().from(funnelEvents).where(eq(funnelEvents.event, 'workspace_created')).orderBy(desc(funnelEvents.occurredAt)))[0];
    assert(wsEvent?.workspaceId);
    await db.insert(subscriptions).values({ workspaceId: wsEvent.workspaceId!, plan: 'starter', status: 'active', stripeSubscriptionId: 'verify-funnel', currentPeriodEnd: new Date(Date.now() + 86400000) });
    await page.goto(base + '/app/brands');
    await page.getByLabel('Name').fill('Funnel brand');
    await Promise.all([page.waitForURL(/\/app\/brands\//), page.getByRole('button', { name: /create brand/i }).click()]);
    const brandUrl = page.url();
    await page.getByLabel('Provider').selectOption('mastodon');
    await page.getByLabel('Instance URL').fill('https://fixture.invalid');
    await page.getByLabel('Access token').fill('fixture-token');
    await Promise.all([page.waitForResponse(r => r.request().method() === 'POST'), page.getByRole('button', { name: /connect channel/i }).click()]);
    await page.waitForLoadState('networkidle');
    let c = await counts(); assert.equal(c.channel_connected - before.channel_connected, 1, (await page.locator('body').innerText()).slice(0, 1200));
    await page.goto(base + '/app/posts/new');
    await page.getByRole('checkbox', { name: /verify@fixture/ }).check();
    await page.getByLabel('Post text').fill('A funnel verification post');
    await page.getByLabel(/Date and time/).fill('2099-01-01T09:00');
    await Promise.all([page.waitForURL(/\/app\/posts\//), page.waitForResponse((r: { request(): { method(): string } }) => r.request().method() === 'POST'), page.getByRole('button', { name: 'Schedule' }).click()]);
    await page.waitForLoadState('networkidle');
    c = await counts(); assert.equal(c.post_scheduled - before.post_scheduled, 1, (await page.locator('body').innerText()).slice(0, 1000));
    const [scheduledPost] = await db.select({ id: posts.id }).from(posts).orderBy(desc(posts.createdAt));
    await db.update(posts).set({ scheduledAt: new Date(Date.now() - 1000) }).where(eq(posts.id, scheduledPost.id));
    await db.update(postTargets).set({ nextAttemptAt: new Date(Date.now() - 1000) }).where(eq(postTargets.postId, scheduledPost.id));
    registerPublisher({ provider: 'mastodon', maxMediaBytes: 16000000, maxTextLength: 500, credentialFields: [], async validate() { return { externalId: 'verify-account', displayName: '@verify' }; }, async publish() { return { remoteId: 'verify-post', url: 'https://fixture.invalid/post' }; } });
    await tick();
    c = await counts(); assert.equal(c.post_published - before.post_published, 1);
    const final = await counts();
    for (const event of journey) assert.equal(final[event] - before[event], 1, `${event} exactly once`);
    console.log('PASS funnel browser journey: eight events exactly once');
    void brandUrl;
  } finally { await browser.close(); await db.$client.end(); }
});
