const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
import assert from 'node:assert/strict';
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH || '/usr/bin/google-chrome',args:['--no-sandbox']});
 try {
 const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto((process.env.VERIFY_BASE_URL || process.env.MARKETING_TEST_URL || 'http://localhost:3991'));await page.waitForLoadState('networkidle');
 await page.screenshot({path:'/tmp/socialmint-desktop.png',fullPage:true});
 await page.getByRole('link',{name:'Try the interactive demo'}).click();
 assert.equal(await page.locator(':focus').getAttribute('id'),'demo-heading');
 const button=name=>page.getByRole('button',{name,exact:true});
 const status=async name=>{await page.locator('.demo-status h3').filter({hasText:name}).waitFor();assert.equal(await page.locator(':focus').innerText(),name);};
 // The demo is lazy-loaded; begin the no-network assertion after its code arrives.
 await button('Approve').waitFor({state:'visible'});await page.waitForLoadState('networkidle');
 const requests=[];page.on('request',r=>!r.url().includes('/icon.svg') && requests.push(r.url()));
 await button('Approve').focus();await page.keyboard.press('Enter');await status('Approved');
 await button('Schedule post').click();await status('Scheduled');
 await button('Simulate publish').click();await status('⚠ Retry pending');
 await button('Run simulated retry').click();await status('⚠ Retrying');
 await button('Show retry result').click();await status('Published');
 assert.equal(await page.locator('.activity li').count(),6);
 assert.match(await page.locator('.activity').innerText(),/Attempt 1 failed/);
 await button('Replay publishing').click();await status('Scheduled');assert.equal(await page.locator('.activity li').count(),3);
 await button('Reset demo').click();await status('Awaiting approval');assert.equal(await page.locator('.activity li').count(),1);
 await button('Request changes').click();await page.getByLabel('Requested changes',{exact:true}).fill('   ');await button('Send request').click();
 assert.equal(await page.getByLabel('Requested changes',{exact:true}).getAttribute('aria-invalid'),'true');
 assert.equal(await page.locator(':focus').getAttribute('id'),'requested-changes');
 assert.equal(await page.locator('#feedback-error').innerText(),'Enter a change request to continue.');
 await page.getByLabel('Requested changes',{exact:true}).fill('<b>Monday please</b>');await button('Send request').click();await status('Changes requested');
 assert.equal(await page.locator('.feedback p').innerText(),'<b>Monday please</b>');assert.equal(await page.locator('.feedback b').count(),0);
 assert.equal(await button('Schedule post').count(),0);
 await button('Preview revision').click();await status('Awaiting approval');assert.match(await page.locator('.post-text').innerText(),/Monday\./);
 await button('Request changes').click();await button('Cancel').click();await status('Awaiting approval');assert.match(await page.locator('.post-text').innerText(),/Monday\./);
 await button('Request changes').click();await button('Send request').click();await button('Preview revision').click();await button('Approve').click();await button('Schedule post').click();await button('Simulate publish').click();await button('Run simulated retry').click();await button('Show retry result').click();await status('Published');
 await page.locator('#demo').screenshot({path:'/tmp/socialmint-demo-published.png'});
 await button('Reset demo').click();assert.equal(await page.locator('.feedback').count(),0);assert.match(await page.locator('.post-text').innerText(),/Friday\./);
 assert.equal(requests.length,0,JSON.stringify(requests));
 assert.equal(await page.evaluate(()=>localStorage.length+sessionStorage.length),0);assert.equal((await page.context().cookies()).length,0);
 console.log('PASS demo: direct + revision, keyboard, focus, validation, escaped feedback, cancel, repeat changes, retained failures, replay/reset; zero interaction requests/storage/cookies after lazy-load (browser favicon excluded)');
 // A source-level check cannot tell whether the beacon is rendered: on 2026-09-11 two
 // insertions landed as dead code after the return and as a bare top-level expression,
 // and the typecheck accepted both. Assert that it actually fires, and only where meant.
 const beaconHits=[];
 page.on('request',request=>{ if(request.url().includes('/api/internal/client-ready')) beaconHits.push(new URL(request.url()).pathname); });
 for (const width of [320,1440]) {
  await page.setViewportSize({width,height:1000});
  for(const route of ['/','/pricing','/docs','/compare','/impressum','/privacy','/terms']){
   const before=beaconHits.length;
   await page.goto((process.env.VERIFY_BASE_URL || process.env.MARKETING_TEST_URL || 'http://localhost:3991')+route);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${route} overflow at ${width}`);
   await page.waitForTimeout(300);
   const fired=beaconHits.length-before;
   if(['/','/pricing','/docs','/compare'].includes(route)) assert.equal(fired,1,`${route} must report that a browser engine ran`);
   else assert.equal(fired,0,`${route} must not report a client beacon`);
  }
 }
 await page.goto((process.env.VERIFY_BASE_URL || process.env.MARKETING_TEST_URL || 'http://localhost:3991'));await page.setViewportSize({width:320,height:800});
 await button('Open navigation').click();assert.equal(await button('Close navigation').getAttribute('aria-expanded'),'true');await page.keyboard.press('Escape');assert.equal(await button('Open navigation').getAttribute('aria-expanded'),'false');
 await page.screenshot({path:'/tmp/socialmint-mobile.png',fullPage:true});
 await page.locator('summary').first().focus();await page.keyboard.press('Enter');assert.equal(await page.locator('details').first().getAttribute('open'),'');
 // 200% of a 640px viewport exercises the supported 320 CSS-pixel layout.
 await page.setViewportSize({width:640,height:1000});
 await page.evaluate(()=>{document.body.style.zoom='2'});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'zoom overflow');
 assert.deepEqual(errors,[]);console.log('PASS 320/1440 all pages, mobile menu + Escape, FAQ keyboard, 200% zoom, no browser errors');
 } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exit(1)});
