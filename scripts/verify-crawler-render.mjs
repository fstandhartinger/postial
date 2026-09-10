import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';

const origin = process.env.VERIFY_BASE_URL || process.argv[2] || 'http://localhost:3987';
const help = JSON.parse(fs.readFileSync(new URL('../content/help/index.json', import.meta.url)));
const compare = JSON.parse(fs.readFileSync(new URL('../content/compare.json', import.meta.url)));
const routes = ['/', '/pricing', '/roadmap', '/legal', '/legal/dpa', '/privacy', '/terms', '/impressum', '/login', '/docs', '/docs/api', ...help.map(x => `/docs/${x.slug}`), '/compare', ...compare.pages.map(x => `/compare/${x.slug}`)];
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
try {
  for (const route of routes) {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    const response = await page.goto(origin + route, { waitUntil: 'load' });
    assert.equal(response?.status(), 200, `${route}: status`);
    assert.equal(await page.locator('main h1').count(), 1, `${route}: main h1 missing without JavaScript`);
    assert.ok((await page.locator('main').innerText()).trim().length > 80, `${route}: main content missing without JavaScript`);
    const robots = await page.locator('meta[name="robots"]').getAttribute('content');
    assert.ok(!robots?.toLowerCase().includes('noindex'), `${route}: noindex set`);
    await context.close();
  }
  console.log(`PASS crawler render: ${routes.length} public pages have SSR main content and no noindex`);
} finally { await browser.close(); }
