// Shared origin takes precedence; historical per-script variables remain supported.
if (process.env.VERIFY_BASE_URL) process.env.DOCS_HTTP_URL = process.env.VERIFY_BASE_URL;
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const index = JSON.parse(readFileSync('content/help/index.json', 'utf8'));
const base = process.env.DOCS_HTTP_URL || 'http://localhost:4018';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
mkdirSync((process.env.VERIFY_EVIDENCE_DIR || '../work') + '/help-evidence', { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ['/docs', ...index.map(article => `/docs/${article.slug}`), '/docs/api', '/privacy', '/terms', '/legal/dpa']) {
      const response = await page.goto(base + route);
      assert.equal(response.status(), 200, route);
      await page.waitForLoadState('networkidle');
      assert.equal(await page.locator('h1').count(), 1, route);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${width} ${route} overflow`);
      await page.screenshot({ path: `${process.env.VERIFY_EVIDENCE_DIR || '../work'}/help-evidence/${route.slice(1).replaceAll('/', '-')}-${width}.png`, fullPage: true });
    }
    await page.goto(base + '/docs');
    const search = page.getByRole('searchbox', { name: 'Search help articles' });
    await search.fill('CSV');
    await page.locator('#help-results').getByRole('link', { name: 'Plan several posts with CSV' }).click();
    await page.waitForURL('**/docs/bulk-csv');
    await search.fill('NO_MATCH_EXPECTED_921');
    await page.getByText('No articles found. Try a shorter phrase or browse the categories.').waitFor();
    await search.fill('needs review');
    await page.locator('#help-results').getByRole('link', { name: 'Understand publishing status and retries' }).waitFor();
    await page.screenshot({ path: `${process.env.VERIFY_EVIDENCE_DIR || '../work'}/help-evidence/search-${width}.png`, fullPage: true });
    await search.fill('');
    await page.getByRole('navigation', { name: 'Help categories' }).getByRole('link', { name: 'Plans, trial and cancellation' }).click();
    await page.waitForURL('**/docs/billing');
  }
  assert.deepEqual(errors, []);
  console.log('PASS: all 24 public docs/legal pages at 390/1280, screenshots, no overflow or browser errors; search, no-results and navigation. No login or publishing.');
} finally { await browser.close(); }
