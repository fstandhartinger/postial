import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { getDb } from '../db';
import { brands, sessions, subscriptions, users } from '../db/schema';
import { ensureWorkspace } from '../lib/workspaces';
import { deleteFixtureUsers } from './fixture-cleanup';

async function main() {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
  const db = getDb(), uid = crypto.randomUUID(), sessionToken = crypto.randomUUID();
  const base = process.env.VERIFY_BASE_URL || 'http://localhost:3992';
  const evidence = process.env.VERIFY_EVIDENCE_DIR || '../work/verification';
  mkdirSync(evidence, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  try {
    await db.insert(users).values({ id: uid, name: 'n8n last-mile fixture' });
    const workspace = await ensureWorkspace(uid);
    await db.insert(sessions).values({ sessionToken, userId: uid, expires: new Date(Date.now() + 600000) });
    await db.insert(subscriptions).values({ workspaceId: workspace.id, plan: 'agency', status: 'trialing', trialEnd: new Date(Date.now() + 86400000), stripeSubscriptionId: 'fixture-n8n-' + uid });
    const [brand] = await db.insert(brands).values({ workspaceId: workspace.id, name: 'n8n Demo Brand', slug: 'n8n-demo' }).returning();
    const context = await browser.newContext();
    await context.addCookies([{ name: 'authjs.session-token', value: sessionToken, url: base }]);
    const page = await context.newPage();
    const anonymous = await fetch(base + '/app', { redirect: 'manual' });
    assert.equal(anonymous.status, 307);
    await page.goto(base + '/app');
    await page.getByRole('heading', { name: 'Overview', exact: true }).waitFor();
    await page.getByRole('link', { name: 'Settings', exact: true }).click();
    await page.getByRole('link', { name: 'API settings', exact: true }).click();
    await page.getByRole('heading', { name: 'API & webhooks', exact: true }).waitFor();
    assert(await page.getByText('Agency, including an Agency trial', { exact: false }).isVisible());
    const form = page.locator('form').filter({ has: page.getByRole('button', { name: 'Create API key', exact: true }) });
    assert(await form.getByText('brands:read', { exact: true }).isVisible());
    assert(await form.getByText('nodes need', { exact: false }).isVisible());
    await form.getByLabel('Key name').fill('n8n verification');
    await form.getByRole('button', { name: 'Create API key', exact: true }).click();
    await page.getByRole('status').waitFor();
    const secret = await page.getByLabel('One-time secret').inputValue();
    assert.match(secret, /^sm_live_[A-Za-z0-9_-]{43}$/);
    assert(await page.getByRole('button', { name: 'Copy API key', exact: true }).isVisible());
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(() => { const input = document.querySelector('[aria-label="One-time secret"]') as HTMLInputElement | null; if (input) input.value = 'REDACTED_FOR_EVIDENCE'; });
      await page.screenshot({ path: `${evidence}/n8n-lastmile-key-${width}.png`, fullPage: true });
      await page.getByLabel('One-time secret').evaluate((input: HTMLInputElement, value: string) => { input.value = value; }, secret);
    }
    const api = async (path: string, init: RequestInit = {}) => fetch(base + '/api/v1' + path, { ...init, headers: { Authorization: `Bearer ${secret}`, ...init.headers } });
    const brandsResponse = await api('/brands');
    assert.equal(brandsResponse.status, 200);
    assert.equal((await brandsResponse.json()).data[0].id, brand.id);
    const draftResponse = await api('/posts', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'n8n-lastmile-fixture-1' }, body: JSON.stringify({ brand_id: brand.id, body: 'First n8n API draft', media_urls: [], channel_ids: [] }) });
    assert.equal(draftResponse.status, 201);
    await page.reload();
    assert.equal(await page.getByLabel('One-time secret').count(), 0);
    console.log('PASS n8n last-mile: /app → API settings → one-time key → brands → draft');
  } finally {
    await browser.close();
    await deleteFixtureUsers(db).where(eq(users.id, uid));
  }
}
main().then(() => process.exit(0)).catch(error => { console.error(error instanceof Error ? error.message : 'n8n last-mile failed'); process.exit(1); });
