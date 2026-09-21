import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium, type Page } from 'playwright';
import { eq } from 'drizzle-orm';
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

/** Reads the numeric cells of the first stage row found in the tables following a section heading. */
async function stageCells(page: Page, heading: string, stage: string): Promise<string[] | null> {
  return page.evaluate(({ heading, stage }) => {
    const h = Array.from(document.querySelectorAll('h2')).find(el => el.textContent?.trim() === heading);
    if (!h) return null;
    // A section can hold several tables (the conversion rates come before the class
    // breakdown), so every table after the heading is a candidate.
    for (let el: Element | null = h.nextElementSibling; el; el = el.nextElementSibling) {
      if (el.tagName !== 'TABLE') continue;
      const row = Array.from(el.querySelectorAll('tr')).find(tr => tr.querySelector('th')?.textContent?.trim() === stage);
      if (row) return Array.from(row.querySelectorAll('td')).map(td => (td.textContent ?? '').trim());
    }
    return null;
  }, { heading, stage });
}

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
  const today = new Date().toISOString().slice(0, 10);
  const marker = `/verify-admin-funnel-${crypto.randomUUID()}`;
  await db.insert(funnelEvents).values([
    { event: 'landing_view', day: today, path: '/', referrerHost: 'postial.net', clientClass: 'browser' },
    { event: 'landing_view', day: today, path: '/', referrerHost: 'news.ycombinator.com', clientClass: 'browser' },
    // Registrations, trial starts and paying conversions need real classes to show numbers.
    { event: 'signup_started', day: today, path: marker, clientClass: 'browser' },
    { event: 'signup_started', day: today, path: marker, clientClass: 'browser' },
    { event: 'signup_started', day: today, path: marker, clientClass: 'browser' },
    { event: 'signup_started', day: today, path: marker, clientClass: 'unknown' },
    { event: 'workspace_created', day: today, path: marker, clientClass: 'browser' },
    { event: 'workspace_created', day: today, path: marker, clientClass: 'browser' },
    { event: 'channel_connected', day: today, path: marker, clientClass: 'browser' },
    { event: 'post_scheduled', day: today, path: marker, clientClass: 'browser' },
    { event: 'checkout_started', day: today, path: marker, clientClass: 'browser' },
    { event: 'checkout_started', day: today, path: marker, clientClass: 'system' },
    { event: 'trial_started', day: today, path: marker, clientClass: 'system' },
    { event: 'trial_started', day: today, path: marker, clientClass: 'system' },
    { event: 'subscription_paid', day: today, path: marker, clientClass: 'system' },
    { event: 'subscription_active', day: today, path: marker, clientClass: 'system' },
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
    for (const heading of ['Registrations', 'Trial starts', 'Paying conversions', 'Success funnel', 'Visible sign-in failures', 'Totals by client class', 'Top referrers']) {
      assert.ok(body.includes(heading), `the rendered page is missing "${heading}"`);
    }
    assert.match(body, /People \(browser\)/, 'the client-class section did not render');

    // The separated referral figures must agree with the API, and the own host must be marked.
    const api = await context.request.get(`${base}/api/admin/funnel?days=30`);
    assert.equal(api.status(), 200);
    const report = await api.json() as {
      ownReferralViews: number; externalReferralViews: number;
      accountTotals: Record<string, number>; billingTotals: Record<string, number>;
      billingConversions: Record<string, number | null>;
      clientClassTotals: Record<string, Record<string, number>>;
    };
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

    // The three new sections must show the seeded numbers per class and carry the
    // plain-English definitions the report ships with.
    assert.ok(body.includes('real browser requests'), 'the Registrations definition is missing');
    assert.ok(body.includes('not a paying conversion'), 'the trial-start definition is missing');
    assert.ok(body.includes('not a paid conversion'), 'the legacy subscription_active definition is missing');
    assert.ok(body.includes('distinct workspaces'), 'the paying-conversions definition is missing');
    assert.ok(body.includes('recovered payment'), 'the past_due exclusion is missing');
    assert.ok(body.includes('First day on which account and billing events carry a real client class'),
      'the class-attribution break is missing');
    const browserCounts = report.clientClassTotals.browser, systemCounts = report.clientClassTotals.system, unknownCounts = report.clientClassTotals.unknown;
    assert.ok((browserCounts.signup_started ?? 0) >= 3 && (unknownCounts.signup_started ?? 0) >= 1, 'seeded registration rows missing from the report');
    assert.ok((systemCounts.trial_started ?? 0) >= 2 && (systemCounts.subscription_paid ?? 0) >= 1, 'seeded billing rows missing from the report');
    assert.deepEqual(await stageCells(page, 'Registrations', 'signup_started'),
      [String(browserCounts.signup_started ?? 0), String(systemCounts.signup_started ?? 0), String(unknownCounts.signup_started ?? 0)],
      'Registrations must show the class breakdown the report carries');
    assert.deepEqual(await stageCells(page, 'Registrations', 'workspace_created'),
      [String(browserCounts.workspace_created ?? 0), String(systemCounts.workspace_created ?? 0), String(unknownCounts.workspace_created ?? 0)]);
    assert.deepEqual(await stageCells(page, 'Trial starts', 'trial_started'),
      [String(browserCounts.trial_started ?? 0), String(systemCounts.trial_started ?? 0), String(unknownCounts.trial_started ?? 0)],
      'Trial starts must break the counts down by class');
    assert.deepEqual(await stageCells(page, 'Paying conversions', 'subscription_paid'),
      [String(browserCounts.subscription_paid ?? 0), String(systemCounts.subscription_paid ?? 0), String(unknownCounts.subscription_paid ?? 0)]);
    const paidRate = report.billingConversions.subscription_paid;
    assert.deepEqual(await stageCells(page, 'Paying conversions', 'trial_started → subscription_paid'),
      [paidRate === null ? 'no data' : `${(paidRate * 100).toFixed(1)}%`],
      'the paying-conversion rate must match the API report, null rendered as no data');
    assert.equal(report.billingTotals.trial_started, (browserCounts.trial_started ?? 0) + (systemCounts.trial_started ?? 0),
      'billing totals are browser + system, excluding internal and automated');

    for (const width of [390, 1280, 1440]) {
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
    await db.delete(funnelEvents).where(eq(funnelEvents.path, marker));
    await db.$client.end();
  }
}

main().catch(error => { console.error('FAIL admin funnel:', error); process.exit(1); });
