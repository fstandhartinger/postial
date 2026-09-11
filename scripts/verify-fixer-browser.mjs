// Shared origin takes precedence; historical per-script variables remain supported.
if (process.env.VERIFY_BASE_URL) process.env.BROWSER_BASE_URL = process.env.VERIFY_BASE_URL;
import postgres from 'postgres';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { assertVerificationDatabase } from './isolated-db.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.BROWSER_BASE_URL || 'http://localhost:3992';
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('response', response => { if (response.status() >= 400) errors.push(`HTTP ${response.status()} ${new URL(response.url()).pathname}`); });
  for (const width of [320, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const route of ['/', '/pricing', '/login?next=/pricing&plan=agency', '/impressum', '/privacy', '/terms']) {
      const response = await page.goto(base + route);
      await page.waitForLoadState('networkidle');
      assert.equal(response.status(), 200);
      const headers = response.headers();
      assert.equal(headers['strict-transport-security'], 'max-age=31536000; includeSubDomains');
      assert.equal(headers['x-content-type-options'], 'nosniff');
      // The framework must not name itself: production shipped x-powered-by until
      // 2026-09-11, and a required-headers check cannot see a header that should be absent.
      assert.equal(headers['x-powered-by'], undefined, 'no x-powered-by header');
      assert.equal(headers['x-frame-options'], 'DENY');
      assert.equal(headers['referrer-policy'], 'strict-origin-when-cross-origin');
      assert.ok(headers['permissions-policy']);
      assert.match(headers['content-security-policy'], /frame-ancestors 'none'/);
      // Only frame-ancestors was pinned, so the rest of the policy could be weakened without
      // anything noticing. These are the directives that carry the protection.
      // upgrade-insecure-requests was tried and withdrawn: it buys almost nothing on an
      // HTTPS-only site with HSTS, and it plausibly interferes with verification over
      // http://localhost. Not worth the risk for the benefit.
      const csp = headers['content-security-policy'];
      for (const directive of ["default-src 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "connect-src 'self' https://api.stripe.com"]) {
        assert.ok(csp.includes(directive), `CSP must keep ${directive}`);
      }
      // script-src still carries 'unsafe-inline' because Next inlines its own hydration
      // payload; removing it needs a per-request nonce and dynamic rendering everywhere,
      // which is its own cycle. 'unsafe-eval' must never appear.
      assert.ok(!csp.includes("'unsafe-eval'"), 'CSP must never allow unsafe-eval');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${width} ${route} overflow`);
      if (route === '/' || route === '/pricing') assert.ok(await page.getByText('Early access', { exact: true }).count());
      if (route === '/pricing') assert.ok(await page.getByText(/Available today:/).count());
      if (route === '/pricing' && width === 1440) await page.screenshot({ path: '/tmp/socialmint-fixer-pricing.png', fullPage: true });
      if (route === '/' && width === 320) await page.screenshot({ path: '/tmp/socialmint-fixer-mobile.png', fullPage: true });
    }
  }
  await page.goto(base + '/pricing');
  await page.getByRole('button', { name: 'Start free trial', exact: true }).nth(1).click();
  await page.waitForURL('**/login?next=/pricing&plan=agency');
  assert.equal(new URL(page.url()).search, '?next=/pricing&plan=agency');
  assert.deepEqual(errors, []);
  console.log('PASS browser: six routes at 320/1440, all security headers, no overflow, no console/page/HTTP errors, Agency CTA preserves plan without 401');
  // Missing runtime configuration now fails at startup (covered by verify-c7).
  // Local DB session fixtures exercise authenticated UI without any provider login.
if (process.env.DATABASE_URL) {
    assertVerificationDatabase();
    const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });
    const userId = randomUUID(), token = randomUUID(), workspaceId = randomUUID();
    try {
      await sql`insert into users (id, name) values (${userId}, 'UI verification fixture')`;
      await sql`insert into sessions (session_token, user_id, expires) values (${token}, ${userId}, ${new Date(Date.now() + 600000)})`;
      await sql`insert into workspaces (id, owner_user_id, name, slug, trial_used_at) values (${workspaceId}, ${userId}, 'UI fixture', ${'fixture-' + workspaceId}, now())`;
      await sql`insert into workspace_members (workspace_id, user_id, role) values (${workspaceId}, ${userId}, 'owner')`;
      await sql`insert into subscriptions (workspace_id, stripe_customer_id, stripe_subscription_id, status) values (${workspaceId}, ${'cus_fixture_' + workspaceId}, ${'sub_fixture_' + workspaceId}, 'canceled')`;
      const context = await browser.newContext();
      await context.addCookies([{ name: 'authjs.session-token', value: token, url: base }]);
      const member = await context.newPage();
      const pageErrors = []; member.on('pageerror', error => pageErrors.push(error.message));
      let calls = 0;
      await member.route('**/api/stripe/checkout', async route => {
        calls++;
        assert.deepEqual(route.request().postDataJSON(), { plan: 'agency' });
        await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'Fixture: checkout resumed' }) });
      });
      await member.goto(base + '/app/continue?next=/pricing&plan=agency');
      await member.getByRole('heading', { name: 'Review your plan before checkout' }).waitFor({ state: 'visible' });
      await member.getByRole('button', { name: 'Continue to checkout' }).waitFor({ state: 'visible' });
      assert.equal(calls, 0);
      await member.getByRole('button', { name: 'Continue to checkout' }).click();
      await member.getByRole('alert').filter({ hasText: 'Fixture: checkout resumed' }).waitFor();
      assert.equal(calls, 1);
      const appLink = member.getByRole('link', { name: 'First set up your brand and look around', exact: true });
      assert.equal(await appLink.count(), 1);
      await appLink.click();
      await member.waitForURL('**/app');
      assert.equal(calls, 1);
      await member.goto(base + '/app/billing');
      await member.getByRole('button', { name: 'Restart plan', exact: true }).first().waitFor();
      assert.equal(await member.getByRole('button', { name: 'Restart plan' }).count(), 2);
      await sql`update sessions set expires = ${new Date(0)} where session_token = ${token}`;
      await member.getByRole('button', { name: 'Manage payment method, plan and cancellation' }).click();
      await member.waitForURL('**/login?next=/app/billing');
      assert.deepEqual(pageErrors, []);
      await context.close();
      console.log('PASS authenticated UI: continuation automatically posts Agency once, retry works, paid Restart plan buttons, expired Portal session returns to login with next. No provider login or Stripe request.');
    } finally {
      await sql`delete from workspaces where id = ${workspaceId}`;
      await sql`delete from users where id = ${userId}`;
      assert.equal((await sql`select id from workspaces where id = ${workspaceId}`).length, 0);
      await sql.end();
      console.log('UI fixture cleanup complete');
    }
  }

} finally { await browser.close(); }
