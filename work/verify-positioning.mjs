import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from '/home/flori/n8n-local/node_modules/playwright/index.mjs';
const base = 'http://127.0.0.1:3987';
const out = 'work/positioning-evidence'; mkdirSync(out,{recursive:true});
const browser = await chromium.launch({executablePath:'/usr/bin/google-chrome', headless:true, args:['--no-sandbox']});
const results=[];
try {
 for (const width of [390,1280]) {
  const page=await browser.newPage({viewport:{width,height:900}});
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  for (const path of ['/','/pricing','/roadmap','/compare/hootsuite-alternative','/compare/postiz-alternative']) {
   const response=await page.goto(base+path,{waitUntil:'networkidle'}); assert.equal(response.status(),200);
   const body=await page.locator('body').innerText(); assert(!body.includes('[CHECK]'));
   assert(body.includes('Bluesky') && body.includes('Mastodon') && body.includes('Telegram'));
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No page overflow');
   for (const element of await page.locator('[data-status="preparation"], [data-status="planned"]').all()) assert(!/[✓✔]/.test(await element.innerText()));
   for (const schema of await page.locator('script[type="application/ld+json"]').all()) {const parsed=JSON.parse(await schema.textContent());assert.equal(parsed['@context'],'https://schema.org');}
   assert(await page.locator('meta[name="description"]').getAttribute('content'));
   if (['/','/pricing','/roadmap'].includes(path)) await page.screenshot({path:`${out}/${path==='/'?'landing':path.slice(1)}-${width}.png`,fullPage:true});
   if (path==='/roadmap' || path==='/pricing') {
    assert.equal(await page.getByRole('button',{name:/Notify me/}).count(),5);
    const card=page.locator('[data-network="linkedin"]');
    await card.getByRole('button',{name:/Notify me/}).click();
    await card.getByLabel('Email for LinkedIn').fill('browser-check@example.com');
    await page.route('**/api/waitlist',route=>route.fulfill({status:201,contentType:'application/json',body:'{"saved":true}'}));
    await card.getByRole('button',{name:'Notify me',exact:true}).click();
    await card.getByRole('status').filter({hasText:'Saved.'}).waitFor();
    await page.unroute('**/api/waitlist');
   }
   results.push(`${width} ${path}: HTTP 200, no overflow/placeholders, correct network states, metadata and JSON-LD valid`);
  }
  assert.deepEqual(errors,[]); await page.close();
 }
 writeFileSync(`${out}/browser-checks.txt`,results.join('\n')+'\nForm success states mocked; actual persistence/rate limiting tested by scripts/verify-waitlist.ts.\n');
 console.log(results.join('\n'));
} finally {await browser.close();}
