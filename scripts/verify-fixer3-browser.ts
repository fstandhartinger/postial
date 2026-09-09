import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { getDb } from '../db';
import { users, sessions, subscriptions, brands, channels, webhookEndpoints, webhookDeliveries } from '../db/schema';
import { ensureWorkspace } from '../lib/workspaces';
async function main() {
  const modulePath = process.env.PLAYWRIGHT_MODULE || '/home/flori/n8n-local/node_modules/playwright/index.mjs';
  const {chromium} = await import(modulePath);
  const db = getDb(), uid = crypto.randomUUID(), token = crypto.randomUUID();
  const base = process.env.FIXER3_HTTP_URL || 'http://localhost:3999';
  const evidence = process.env.FIXER3_EVIDENCE || '/home/flori/ventures2/socialmint/work/fixer3-evidence';
  mkdirSync(evidence, {recursive: true});
  const browser = await chromium.launch({executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox']});
  try {
    await db.insert(users).values({id: uid, name: 'Fixer3 browser fixture'});
    const workspace = await ensureWorkspace(uid);
    await db.insert(sessions).values({sessionToken: token, userId: uid, expires: new Date(Date.now() + 600000)});
    await db.insert(subscriptions).values({workspaceId: workspace.id, plan: 'starter', status: 'active', stripeSubscriptionId: 'fixture-fixer3-' + uid, currentPeriodEnd: new Date(Date.now() + 86400000)});
    const [brand] = await db.insert(brands).values({workspaceId: workspace.id, name: 'Maple Studio', slug: 'maple'}).returning();
    const context = await browser.newContext();
    await context.addCookies([{name: 'authjs.session-token', value: token, url: base}]);
    const page = await context.newPage(); const errors: string[] = [];
    page.on('pageerror', () => errors.push('pageerror'));
    for (const width of [390, 1280]) {
      await page.setViewportSize({width, height: 900});
      await page.goto(base + '/app/posts/new');
      await page.getByRole('heading', {name: 'Create a post', exact: true}).waitFor();
      assert(await page.getByRole('button', {name: 'Schedule', exact: true}).isDisabled());
      assert(await page.getByRole('button', {name: 'Save draft', exact: true}).isEnabled());
      assert(await page.locator('[name=requiresApproval]').isDisabled());
      assert(await page.getByText('Included with Agency —', {exact: false}).isVisible());
      assert(await page.getByText('Connect a channel to publish', {exact: false}).isVisible());
      await page.locator('select[name=when]').selectOption('now');
      assert(await page.getByRole('button', {name: 'Publish now', exact: true}).isDisabled());
      await page.screenshot({path: `${evidence}/composer-no-channel-${width}.png`, fullPage: true});
    }
    await db.insert(channels).values({brandId: brand.id, provider: 'mastodon', displayName: 'Maple feed', externalId: uid, credentialsEnc: 'never-publish-fixture'});
    for (const width of [390, 1280]) {
      await page.setViewportSize({width, height: 900}); await page.goto(base + '/app/posts/new');
      await page.getByLabel('Maple feed', {exact: false}).check();
      assert(await page.locator('[name=requiresApproval]').isDisabled());
      assert(await page.getByRole('button', {name: 'Schedule', exact: true}).isEnabled());
      await page.screenshot({path: `${evidence}/composer-starter-${width}.png`, fullPage: true});
    }
    await page.goto(base + '/app');
    await page.getByRole('heading', {name: 'Overview', exact: true}).waitFor();
    await page.screenshot({path: `${evidence}/overview-starter.png`, fullPage: true});
    assert.equal(await page.getByRole('link', {name: 'Prepare approval link', exact: true}).count(), 0);
    assert(await page.getByRole('link', {name: 'Included with Agency — upgrade', exact: true}).isVisible());
    await db.update(subscriptions).set({plan: 'agency'}).where(eq(subscriptions.workspaceId, workspace.id));
    const [endpoint] = await db.insert(webhookEndpoints).values({workspaceId: workspace.id, url: 'https://example.invalid/hooks', events: ['approval.decided'], secretHash: 'unused', secretEnc: 'unused', active: false}).returning();
    await db.insert(webhookDeliveries).values(['paused', 'canceled', 'delivered'].map(status => ({endpointId: endpoint.id, event: 'approval.decided', payload: {test: true}, status: status as 'paused' | 'canceled' | 'delivered', attempts: status === 'delivered' ? 1 : 0, responseStatus: status === 'delivered' ? 204 : null, nextAttemptAt: null, pauseReason: status === 'paused' ? 'Endpoint disabled' : null})));
    for (const width of [390, 1280]) {
      await page.setViewportSize({width, height: 900}); await page.goto(base + '/app/settings/api');
      await page.getByRole('heading', {name: 'Latest 20 deliveries'}).waitFor();
      await (width < 768 ? page.getByRole('list', {name: 'Delivery log'}) : page.getByRole('table')).waitFor({state: 'visible'});
      assert.equal(await page.getByRole('list', {name: 'Delivery log'}).isVisible(), width < 768);
      assert.equal(await page.getByRole('table').isVisible(), width >= 768);
      assert(await page.getByRole('button', {name: 'Enable webhook', exact: true}).isVisible());
      assert(await page.getByRole('button', {name: 'Delete webhook', exact: true}).isVisible());
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.getByRole('heading', {name: 'Latest 20 deliveries'}).scrollIntoViewIfNeeded();
      await page.screenshot({path: `${evidence}/settings-log-${width}.png`, fullPage: true});
    }
    assert.equal(errors.length, 0);
    console.log('PASS E03/E10/E12 Playwright 390/1280: disabled publish/schedule with no channel, draft enabled, Starter approval disabled, onboarding upgrade, mobile cards/desktop table; no pageerrors or horizontal overflow');
  } finally {
    await browser.close(); await db.delete(users).where(eq(users.id, uid));
    assert.equal((await db.select().from(users).where(eq(users.id, uid))).length, 0);
    console.log('PASS browser fixture cleanup');
  }
}
main().then(() => process.exit(0)).catch(e => {console.error(e instanceof Error ? e.message : 'Browser verification failed'); process.exit(1);});
