import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { getDb } from '../db';
import { funnelEvents, sessions, users } from '../db/schema';

/**
 * Renders /app/admin/funnel, which had no render coverage at all until 2026-09-12 although it is
 * the one readout Florian actually uses. The two existing checks read the page's SOURCE and match
 * strings in it; that passes even when the page throws or the JSX is dead. Five of seven
 * ClientBeacon insertions once rendered nothing while tsc stayed green, so the numbers are read
 * off the rendered page here and compared with the API that feeds it.
 *
 * The negative case matters more than the positive one: an authenticated user who is not an admin
 * must get 404, and that had never been exercised over HTTP.
 */
const base = process.env.VERIFY_BASE_URL ?? 'http://localhost:3992';
const evidence = process.env.VERIFY_EVIDENCE_DIR ?? 'work';
const ADMIN_EMAIL = 'admin-fixture@example.invalid';

async function main() {
  mkdirSync(evidence, { recursive: true });
  const db = getDb();
  const adminId = crypto.randomUUID(), adminToken = crypto.randomUUID();
  const strangerId = crypto.randomUUID(), strangerToken = crypto.randomUUID();
  const expires = new Date(Date.now() + 300_000);
  await db.insert(users).values([
    { id: adminId, name: 'Admin fixture', email: ADMIN_EMAIL },
    { id: strangerId, name: 'Stranger fixture', email: `${strangerId}@example.invalid` },
  ]);
  await db.insert(sessions).values([
    { userId: adminId, sessionToken: adminToken, expires },
    { userId: strangerId, sessionToken: strangerToken, expires },
  ]);
  // One own-host referral and one external, so the separated figures cannot both be zero and pass
  // by accident.
  await db.insert(funnelEvents).values([
    { event: 'landing_view', day: new Date().toISOString().slice(0, 10), path: '/', referrerHost: 'postial.net', clientClass: 'browser' },
    { event: 'landing_view', day: new Date().toISOString().slice(0, 10), path: '/', referrerHost: 'news.ycombinator.com', clientClass: 'browser' },
  ]);

  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.addCookies([{ name: 'authjs.session-token', value: adminToken, url: base }]);
    const page = await context.newPage();
    const failures: string[] = [];
    page.on('pageerror', error => failures.push(`page error: ${error.message}`));
    page.on('console', message => { if (message.type() === 'error') failures.push(`console: ${message.text()}`); });

    const response = await page.goto(`${base}/app/admin/funnel`);
    assert.equal(response?.status(), 200, 'an admin must reach the readout');
    await page.waitForSelector('h1');
    assert.equal(await page.locator('h1').first().innerText(), 'Funnel');
    const body = await page.locator('body').innerText();
    for (const heading of ['Success funnel', 'Visible sign-in failures', 'Totals by client class', 'Top referrers']) {
      assert.ok(body.includes(heading), `the rendered page is missing "${heading}"`);
    }
    assert.match(body, /People \(browser\)/, 'the client-class section did not render');

    // The separated referral figures must agree with the API, and the own host must be marked.
    const api = await context.request.get(`${base}/api/admin/funnel?days=30`);
    assert.equal(api.status(), 200);
    const report = await api.json() as { ownReferralViews: number; externalReferralViews: number };
    assert.ok(report.ownReferralViews >= 1 && report.externalReferralViews >= 1, 'fixture referrals missing from the report');
    // The host this instance is served from must count as ours, not as a site people came from.
    // The first rendered readout listed localhost among the external arrivals.
    const appHost = new URL(base).hostname;
    assert.match(body, new RegExp(`${appHost.replace(/\./g, '\\.')}: \\d+ \\(ours\\)`),
      'the host we are served from is not counted as ours');
    assert.ok(body.includes(`${report.externalReferralViews} view(s) arrived from another site`),
      'the rendered page does not carry the external arrival count from the report');
    assert.ok(body.includes(`${report.ownReferralViews} were hops through our own redirects`),
      'the rendered page does not carry the own-redirect count from the report');
    assert.match(body, /postial\.net: \d+ \(ours\)/, 'our own referrer host is not marked as ours');
    assert.doesNotMatch(body, /news\.ycombinator\.com: \d+ \(ours\)/, 'an external host was marked as ours');

    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.screenshot({ path: `${evidence}/admin-funnel-${width}.png`, fullPage: true });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      assert.equal(overflow, false, `the readout overflows horizontally at ${width}px`);
    }
    assert.deepEqual(failures, [], 'the readout produced browser errors');
    await context.close();

    // An authenticated stranger must not see it. This is the assertion the page never had.
    const other = await browser.newContext();
    await other.addCookies([{ name: 'authjs.session-token', value: strangerToken, url: base }]);
    const strangerPage = await other.newPage();
    const denied = await strangerPage.goto(`${base}/app/admin/funnel`);
    assert.equal(denied?.status(), 404, 'a signed-in stranger must get 404, not the readout');
    const deniedApi = await other.request.get(`${base}/api/admin/funnel`);
    assert.equal(deniedApi.status(), 404, 'the admin API must answer 404 for a stranger');
    await other.close();

    // And nobody at all.
    const anonymous = await browser.newContext();
    const anonymousPage = await anonymous.newPage();
    assert.equal((await anonymousPage.goto(`${base}/app/admin/funnel`))?.status(), 404, 'an anonymous visitor must get 404');
    await anonymous.close();
    console.log('PASS admin funnel: renders for an admin with figures matching the API, 404 for a signed-in stranger and for nobody');
  } finally {
    await browser.close();
  }
}

main().catch(error => { console.error('FAIL admin funnel:', error); process.exit(1); });
