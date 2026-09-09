import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { eq, inArray } from 'drizzle-orm';
import { getDb } from '../db';
import { users, sessions, subscriptions, brands, channels, posts, workspaceMembers, postTargets } from '../db/schema';
import { ensureWorkspace } from '../lib/workspaces';
import { deleteFixtureUsers } from './fixture-cleanup';
import { newApprovalToken } from '../lib/approvals';
import { statusLabel } from '../lib/status-label';
import { calendarWindow } from '../lib/calendar-window';

async function main() {
  const base = process.env.C8_HTTP_URL || 'http://localhost:4098';
  const out = process.env.C8_EVIDENCE || '/home/flori/ventures2/socialmint/work/fixer8-evidence';
  mkdirSync(out, {recursive:true});
  const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
  const browser = await chromium.launch({executablePath:'/usr/bin/google-chrome', headless:true, args:['--no-sandbox']});
  const db = getDb(), ids = [crypto.randomUUID(), crypto.randomUUID()], token = crypto.randomUUID();
  const result: Record<string, unknown> = {};
  try {
    assert.equal(calendarWindow('2026-09-09','week').start, '2026-09-07');
    assert.equal(calendarWindow('garbage').view, 'month');
    for (const status of ['pending_approval','needs_review','alert.needs_review','held']) assert(!statusLabel(status).includes('_'));
    await db.insert(users).values(ids.map((id,i)=>({id,name:`Fixer8 ${i ? 'Editor' : 'Owner'}`})));
    const ws = await ensureWorkspace(ids[0]);
    await db.insert(workspaceMembers).values({workspaceId:ws.id,userId:ids[1],role:'editor'});
    await db.insert(sessions).values({sessionToken:token,userId:ids[0],expires:new Date(Date.now()+3600000)});
    await db.insert(subscriptions).values({workspaceId:ws.id,plan:'agency',status:'active',stripeSubscriptionId:'fixture-c8-'+ws.id,currentPeriodEnd:new Date(Date.now()+86400000)});
    const [brand] = await db.insert(brands).values({workspaceId:ws.id,name:'Fixer8 Studio',slug:'fixer8',timezone:'Europe/Berlin'}).returning();
    const [channel] = await db.insert(channels).values({brandId:brand.id,provider:'mastodon',displayName:'Fixture feed',externalId:ids[0],credentialsEnc:'never-publish-fixture'}).returning();
    const c = await browser.newContext({viewport:{width:390,height:900}});
    await c.addCookies([{name:'authjs.session-token',value:token,url:base}]);
    const p = await c.newPage();
    const goto = async (url: string) => { await p.goto(url); await p.waitForLoadState('networkidle'); };
    const measurements: unknown[] = [];
    const measure = async (size: number) => {
      for (const path of ['/app','/app/posts','/app/calendar?date=2026-09-09']) {
        await fetch(base+path,{headers:{cookie:'authjs.session-token='+token}}).then(r=>r.text());
        const samples=[];
        for(let i=0;i<5;i++) {
          const start=performance.now(),r=await fetch(base+path,{headers:{cookie:'authjs.session-token='+token}}),headerMs=performance.now()-start,html=await r.text();
          assert.equal(r.status,200); assert(!html.includes('Application error'));
          samples.push({headerMs,loadMs:performance.now()-start,htmlBytes:Buffer.byteLength(html)});
        }
        measurements.push({size,path,samples});
      }
    };
    const inserted = await db.insert(posts).values(Array.from({length:500},(_,i)=>({brandId:brand.id,authorUserId:ids[0],body:`Fixture post ${i}`,status:'scheduled' as const,scheduledAt:new Date(i<200?'2026-09-10T08:00:00Z':'2026-10-20T08:00:00Z')}))).returning({id:posts.id});
    await measure(500);
    await goto(base+'/app/posts');
    const postLinks=p.locator('main a[href^="/app/posts/"]').filter({hasText:/^Fixture post/});
    assert.equal(await postLinks.count(),50);
    const first=await postLinks.allTextContents();
    await p.getByRole('link',{name:'Next page',exact:true}).click();
    await p.waitForURL('**page=2');
    assert.equal(await postLinks.count(),50);
    assert((await postLinks.allTextContents()).every((s:string)=>!first.includes(s)));
    await goto(base+'/app/posts?status=draft'); assert.equal(await postLinks.count(),0);
    await goto(base+'/app/posts?page=99999'); assert(await p.getByText('500 posts · Page 10 of 10').isVisible());
    await goto(base+'/app/calendar?date=2026-09-09&view=week');
    assert.equal(await p.locator('[data-testid=calendar-agenda] a[href^="/app/posts/"]').count(),200);
    await p.getByRole('button',{name:'Next period'}).click();
    await p.waitForURL('**date=2026-09-16**');
    assert.equal(await p.locator('[data-testid=calendar-agenda] a[href^="/app/posts/"]').count(),0);
    await goto(base+'/app/calendar?date=2026-10-20&view=week');
    assert.equal(await p.locator('[data-testid=calendar-agenda] a[href^="/app/posts/"]').count(),300);
    const [edge]=await db.insert(posts).values({brandId:brand.id,body:'Timezone boundary',scheduledAt:new Date('2026-09-06T22:30:00Z')}).returning();
    await goto(base+'/app/calendar?date=2026-09-09&view=week');
    assert.equal(await p.getByText('Timezone boundary',{exact:true}).count(),2);
    await db.delete(posts).where(eq(posts.id,edge.id));
    const focus=[];
    for(const [path,name] of [['/app/posts/new?brand='+brand.id,'Upload images'],['/app/settings/team','Save role']]) {
      await goto(base+path);await p.waitForLoadState('networkidle');
      await p.locator('body').click({position:{x:1,y:1}});
      let found=0;
      const expected = name === "Save role" ? 2 : 1;
      for(let i=0;i<80;i++) {
        await p.keyboard.press('Tab');await p.waitForTimeout(60);
        const matches=await p.evaluate((name:string)=>{const e=document.activeElement as HTMLInputElement;return (e.labels?.[0]?.textContent||e.textContent||'').trim()===name;},name);
        if(!matches) continue;
        found++; await p.waitForTimeout(200);
        const geometry=await p.evaluate(()=>{const e=document.activeElement!,r=e.getBoundingClientRect(),n=document.querySelector('.app-bottom-nav')!.getBoundingClientRect();return {top:r.top,bottom:r.bottom,navTop:n.top,focusVisible:e.matches(':focus-visible')};});
        assert(geometry.top>=0 && geometry.bottom<=geometry.navTop-8, name+' visible above nav');assert(geometry.focusVisible);
        focus.push({name,...geometry});await p.screenshot({path:out+'/focus-'+name.replaceAll(' ','-')+'-'+found+'.png'});if(found===expected) break;
      }
      assert.equal(found,expected,'Tab reaches every '+name);
    }
    result.focus=focus;
    await goto(base+'/app/posts/bulk?brand='+brand.id);await p.waitForLoadState('networkidle');
    const table=p.getByRole('table',{name:'Bulk posts editor'});
    const mobile=await table.evaluate((e:HTMLTableElement)=>({display:getComputedStyle(e.rows[1]).display,width:e.scrollWidth,viewport:innerWidth,cells:[...e.rows[1].cells].map(c=>({left:c.getBoundingClientRect().left,right:c.getBoundingClientRect().right}))}));
    assert.equal(mobile.display,'block');assert(mobile.cells.every((r:{left:number;right:number})=>r.left>=0&&r.right<=390));result.bulkMobile=mobile;
    await p.screenshot({path:out+'/bulk-cards-390.png',fullPage:true});
    await p.setViewportSize({width:1280,height:900});assert.equal(await table.evaluate((e:HTMLTableElement)=>getComputedStyle(e.rows[1]).display),'table-row');
    await p.screenshot({path:out+'/bulk-table-1280.png',fullPage:true});
    const approvalToken=newApprovalToken(),url='https://example.invalid/fixture.png';
    const [review]=await db.insert(posts).values({brandId:brand.id,body:'Alt text fixture',requiresApproval:true,status:'pending_approval',approvalToken,mediaUrls:[url,'https://example.invalid/second.png'],mediaAlt:{[url]:'Studio "mint" <sign> & team'}}).returning();
    await db.insert(postTargets).values({postId:review.id,channelId:channel.id});
    await p.route('**/r/*?media=*', async (route: {fulfill(options:object):Promise<void>})=>route.fulfill({status:200,contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="#047857"/></svg>'}));
    await goto(base+'/r/'+approvalToken);
    assert.equal(await p.locator('img').first().getAttribute('alt'),'Studio "mint" <sign> & team');
    assert.equal(await p.locator('img').nth(1).getAttribute('alt'),'Image 2 of 2');
    result.alt='Saved text escaped correctly; missing text falls back to Image 2 of 2';
    const axeResults=[];
    for(const width of [390,1280]) for(const path of ['/','/pricing','/app','/app/posts','/app/calendar','/app/posts/new?brand='+brand.id,'/app/posts/bulk?brand='+brand.id,'/app/settings/team','/app/settings/notifications','/app/billing','/r/'+approvalToken]) {
      await p.setViewportSize({width,height:900});await goto(base+path);await p.waitForLoadState('networkidle');
      await p.addScriptTag({path:'/home/flori/ventures2/socialmint/work/critic8-evidence/node_modules/axe-core/axe.min.js'});
      const scan=await p.evaluate(async()=>{
        const axe=(window as unknown as {axe:{run(d:Document,o:object):Promise<{violations:{id:string}[];incomplete:{id:string}[]}>}}).axe;
        const r=await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']}});
        return {violations:r.violations,incomplete:r.incomplete.map(v=>v.id)};
      });
      axeResults.push({width,path:path.startsWith('/r/')?'/r/[fixture]':path.split('?')[0],...scan});
      assert.equal(scan.violations.length,0,'axe '+path.split('?')[0]);
    }
    result.axe=axeResults;
    await db.delete(posts).where(inArray(posts.id,inserted.slice(3).map(r=>r.id)));
    await db.delete(posts).where(eq(posts.id,review.id));
    await measure(3);result.appPerformance=measurements;
    await db.delete(posts).where(eq(posts.brandId,brand.id));
    const weekly = await db.insert(posts).values(['scheduled','approved','draft'].map(status=>({brandId:brand.id,body:'Weekly counter',status:status as 'scheduled'|'approved'|'draft',scheduledAt:new Date()}))).returning();
    const [secondChannel] = await db.insert(channels).values({brandId:brand.id,provider:'mastodon',displayName:'Second feed',externalId:ids[1],credentialsEnc:'never-publish-fixture'}).returning();
    await db.insert(postTargets).values([
      {postId:weekly[2].id,channelId:channel.id,status:'published',publishedAt:new Date()},
      {postId:weekly[2].id,channelId:secondChannel.id,status:'published',publishedAt:new Date()},
      {postId:weekly[1].id,channelId:channel.id,status:'failed',updatedAt:new Date()},
    ]);
    await goto(base+'/app');
    assert.deepEqual(await p.getByRole('region',{name:'This week'}).locator('p.text-3xl').allTextContents(),['2','1','1']);
    result.weeklyCounters='SQL counts scheduled/approved and distinct posts with partial target outcomes: 2 / 1 / 1';
    console.log('PASS C8: 50-row pages, filter/count/clamp, week navigation, timezone boundary, mobile keyboard focus, bulk cards/desktop table, escaped alt/fallback, 22 axe scans, 3/500-post measurements');
  } finally {
    writeFileSync(out+'/c8-results.json',JSON.stringify(result,null,2));
    await browser.close();await deleteFixtureUsers(db).where(inArray(users.id,ids));await db.$client.end();
  }
}
main().catch(e=>{console.error(e);process.exit(1);});
