// Shared origin takes precedence; historical per-script variables remain supported.
if (process.env.VERIFY_BASE_URL) process.env.C6_HTTP_URL = process.env.VERIFY_BASE_URL;
import { deleteFixtureUsers } from './fixture-cleanup';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {createServer} from 'node:http';
import {mkdirSync,readFileSync} from 'node:fs';
import {and,eq,inArray} from 'drizzle-orm';
import {getDb} from '../db';
import {users,brands,channels,posts,postTargets,postEvents,subscriptions,webhookEndpoints,webhookDeliveries,dpaAcceptances,sessions,workspaceMembers} from '../db/schema';
import {ensureWorkspace} from '../lib/workspaces';
import {encryptCredentials,decryptCredentials} from '../lib/crypto';
import {savePost,reschedulePost} from '../lib/api/post-service';
import {createApiKey} from '../lib/api/auth';
import {PATCH} from '../app/api/v1/posts/[id]/route';
import {trialNotice} from '../lib/trial-notice';
import {createAlertDestination,testAlert,notifyWorkspace,markNotificationRead,unreadNotifications} from '../lib/notifications';
import {deliverWebhooks,emit,signature,validateWebhookUrl} from '../lib/api/webhooks';
import {acceptDpa,dpaHash,dpaVersion} from '../lib/dpa';
import {stripe} from '../lib/stripe';
import {nextCharge} from '../lib/billing-summary';
import availability from '../content/availability.json';

async function main(){
  assert.notEqual(process.env.NODE_ENV,'production');
  process.env.WEBHOOK_ALLOW_LOOPBACK='1';
  process.env.AUTH_URL ||= 'http://localhost:3997';
  process.env.NEXT_PUBLIC_APP_URL ||= process.env.AUTH_URL;
  const db=getDb(),userId=crypto.randomUUID(),foreignId=crypto.randomUUID();
  const receipts:{body:string;signature:string}[]=[];
  let responseStatus=200;
  const receiver=createServer(async(req,res)=>{let body='';for await(const part of req)body+=part;receipts.push({body,signature:String(req.headers['x-socialmint-signature'])});res.writeHead(responseStatus);res.end('ok');});
  await new Promise<void>(resolve=>receiver.listen(0,'127.0.0.1',resolve));
  const url=`http://127.0.0.1:${(receiver.address() as {port:number}).port}/private-destination`;
  let browser: {close:()=>Promise<void>}|undefined;
  try{
    const now=Date.now(),end=new Date(now+3*86400000).toISOString();
    assert.equal(trialNotice({status:'trialing',trialEnd:end},now-1),null);
    assert.equal(trialNotice({status:'trialing',trialEnd:end},now),'ending');
    assert.equal(trialNotice({status:'trialing',trialEnd:end},now+3*86400000),'expired');
    assert.equal(trialNotice({status:'active',trialEnd:end},now+4*86400000),null);
    await db.insert(users).values([{id:userId,name:'Cycle 6 agency'},{id:foreignId,name:'Cycle 6 editor'}]);
    const workspace=await ensureWorkspace(userId),foreign=await ensureWorkspace(foreignId);
    await db.insert(workspaceMembers).values({workspaceId:workspace.id,userId:foreignId,role:'editor'});
    await db.insert(subscriptions).values({workspaceId:workspace.id,plan:'agency',status:'trialing',trialEnd:new Date(now+2*86400000),stripeSubscriptionId:'c6-'+userId});
    const [brand]=await db.insert(brands).values({workspaceId:workspace.id,name:'Agency studio',slug:'c6',timezone:'Europe/Berlin'}).returning();
    const [channel]=await db.insert(channels).values({brandId:brand.id,provider:'mastodon',displayName:'Studio Mastodon',externalId:'c6',credentialsEnc:encryptCredentials({accessToken:'synthetic-c6',instanceUrl:'https://fixture.invalid'}),lastCheckedAt:new Date()}).returning();
    const ctx={db,workspace,userId};
    const form=new FormData();for(const [key,value] of Object.entries({brandId:brand.id,body:'Reviewable client content',intent:'publish',scheduledAt:new Date(now+86400000).toISOString()}))form.set(key,value);form.append('channelId',channel.id);
    const postId=await savePost(ctx,form,true);
    const getPost=async()=> (await db.select().from(posts).where(eq(posts.id,postId)))[0];
    const getTarget=async()=> (await db.select().from(postTargets).where(eq(postTargets.postId,postId)))[0];
    const later=new Date(now+5*86400000).toISOString();await reschedulePost(ctx,postId,later);
    assert.equal((await getPost()).scheduledAt?.toISOString(),later);assert.equal((await getTarget()).nextAttemptAt?.toISOString(),later);
    assert((await db.select().from(postEvents).where(eq(postEvents.postId,postId))).some(e=>e.type==='rescheduled'&&e.message.includes(later)));
    await assert.rejects(reschedulePost({...ctx,workspace:foreign},postId,later));
    await assert.rejects(reschedulePost(ctx,postId,new Date(0).toISOString()));
    const key=await createApiKey(workspace.id,userId,'C6',['posts:read','posts:write']);
    const apiLater=new Date(now+6*86400000).toISOString();
    const patch=(data:unknown,token=key.token)=>PATCH(new Request('http://localhost/api/v1/posts/'+postId,{method:'PATCH',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(data)}),{params:Promise.resolve({id:postId})});
    assert.equal((await patch({scheduled_at:apiLater})).status,200);assert.equal((await getTarget()).nextAttemptAt?.toISOString(),apiLater);
    assert.equal((await patch({scheduled_at:'yesterday'})).status,422);assert.equal((await patch({scheduled_at:apiLater,body:'not allowed'})).status,422);assert.equal((await patch({scheduled_at:apiLater},'bad')).status,401);
    await db.update(postTargets).set({status:'publishing'}).where(eq(postTargets.postId,postId));assert.equal((await patch({scheduled_at:later})).status,409);
    form.set('postId',postId);form.set('body','Revised text');await assert.rejects(savePost(ctx,form,true));
    await db.update(postTargets).set({status:'queued'}).where(eq(postTargets.postId,postId));
    await savePost(ctx,form,true);assert.equal((await getPost()).body,'Revised text');
    await db.update(posts).set({status:'approved',requiresApproval:true,approvalToken:'old-'+userId}).where(eq(posts.id,postId));
    await reschedulePost(ctx,postId,later);assert.equal((await getPost()).status,'approved');
    form.set('body','Client content changed after approval');await savePost(ctx,form,true);
    const edited=await getPost();assert.equal(edited.status,'pending_approval');assert.equal(edited.requiresApproval,true);assert.notEqual(edited.approvalToken,'old-'+userId);assert.equal((await getTarget()).nextAttemptAt,null);
    assert((await db.select().from(postEvents).where(eq(postEvents.postId,postId))).some(e=>e.message.includes('Approval reset')));
    for(const kind of ['slack','discord','mattermost']){
      const dest=await createAlertDestination(workspace.id,userId,kind,url,['failed','held','needs_review','approval.decided','token_expired']);
      const [endpoint]=await db.select().from(webhookEndpoints).where(eq(webhookEndpoints.id,dest.id));assert.equal(endpoint.url,'');assert(!endpoint.secretEnc.includes(url));
      await testAlert(workspace.id,userId,dest.id);await assert.rejects(testAlert(workspace.id,userId,dest.id));
    }
    await assert.rejects(createAlertDestination(workspace.id,foreignId,'slack',url,['failed']));
    await db.transaction(async tx=>{
      await emit(tx,postId,'post.failed',{status:'failed'});await emit(tx,postId,'post.needs_review',{target_id:(await getTarget()).id});await emit(tx,postId,'approval.decided',{decision:'approved'});
      await notifyWorkspace(tx,workspace.id,'held',postId);await notifyWorkspace(tx,workspace.id,'token_expired',postId);
    });
    const notices=await unreadNotifications(workspace.id,userId);assert.equal(notices.length,5);assert.deepEqual(notices.map(n=>n.type).sort(),['failed','needs_review','held','approval.decided','token_expired'].sort());
    await markNotificationRead(foreign.id,foreignId,notices[0].id);assert.equal((await unreadNotifications(workspace.id,userId)).length,5);
    await markNotificationRead(workspace.id,userId,notices[0].id);assert.equal((await unreadNotifications(workspace.id,userId)).length,4);
    // Alerts must still reach the team when billing access ends.
    await db.update(subscriptions).set({trialEnd:new Date(now-1)}).where(eq(subscriptions.workspaceId,workspace.id));
    for(let i=0;i<3;i++) await deliverWebhooks();
    const endpoints=await db.select().from(webhookEndpoints).where(eq(webhookEndpoints.workspaceId,workspace.id));
    const deliveries=await db.select().from(webhookDeliveries).where(inArray(webhookDeliveries.endpointId,endpoints.map(e=>e.id)));
    assert.equal(deliveries.length,18);assert(deliveries.every(d=>d.status==='delivered'));assert.equal(receipts.length,18);
    for(const receipt of receipts){const payload=JSON.parse(receipt.body),delivery=deliveries.find(d=>d.payload.id===payload.id)!;const endpoint=endpoints.find(e=>e.id===delivery.endpointId)!;const timestamp=receipt.signature.match(/^t=(\d+),/)![1];assert.equal(receipt.signature,signature(decryptCredentials(endpoint.secretEnc).secret,timestamp,receipt.body));assert(typeof payload[endpoint.kind==='discord'?'content':'text']==='string');assert(!receipt.body.includes(edited.body));}
    responseStatus=503;
    await db.transaction(tx=>notifyWorkspace(tx,workspace.id,'failed',postId));await deliverWebhooks();
    const retries=await db.select().from(webhookDeliveries).where(and(inArray(webhookDeliveries.endpointId,endpoints.map(e=>e.id)),eq(webhookDeliveries.status,'pending')));assert.equal(retries.length,3);assert(retries.every(d=>d.attempts===1&&d.nextAttemptAt!.getTime()>Date.now()));
    responseStatus=200;await db.update(webhookDeliveries).set({nextAttemptAt:new Date(0)}).where(inArray(webhookDeliveries.id,retries.map(d=>d.id)));await deliverWebhooks();
    process.env.WEBHOOK_ALLOW_LOOPBACK='0';await assert.rejects(validateWebhookUrl(url));process.env.WEBHOOK_ALLOW_LOOPBACK='1';
    await assert.rejects(acceptDpa(workspace.id,foreignId));await acceptDpa(workspace.id,userId);await acceptDpa(workspace.id,userId);
    const accepted=await db.select().from(dpaAcceptances).where(eq(dpaAcceptances.workspaceId,workspace.id));assert.equal(accepted.length,1);assert.equal(accepted[0].userId,userId);assert.equal(accepted[0].version,dpaVersion);assert.equal(accepted[0].documentHash,dpaHash);assert(accepted[0].acceptedAt);
    assert.deepEqual(availability.channels,['Bluesky','Mastodon','Telegram']);assert(!availability.starter.some(s=>/\b(X|Threads|LinkedIn)\b/.test(s)));assert(availability.pending.includes('pending'));
    for(const file of ['components/billing/AccessStatus.tsx','components/marketing/Plans.tsx','components/marketing/FAQ.tsx','app/page.tsx','app/compare/[slug]/page.tsx'])assert(readFileSync(file,'utf8').match(/availability|NetworkAvailability/));
    assert(readFileSync('app/pricing/page.tsx','utf8').includes('AccessStatus'));
    // Stripe reads are mocked; no payment objects or customer accounts are created here.
    const client=stripe(),oldSub=client.subscriptions.retrieve,oldCustomer=client.customers.retrieve,oldPreview=client.invoices.createPreview;
    try {
      const sub=(await db.select().from(subscriptions).where(eq(subscriptions.workspaceId,workspace.id)))[0];sub.stripeCustomerId='cus_c6_mock';sub.trialEnd=new Date(now+86400000);
      client.subscriptions.retrieve=(async()=>({default_payment_method:null})) as unknown as typeof oldSub;
      client.customers.retrieve=(async()=>({invoice_settings:{default_payment_method:null},default_source:null})) as unknown as typeof oldCustomer;
      assert.equal(await nextCharge(sub),'No charge scheduled');
      client.subscriptions.retrieve=(async()=>({default_payment_method:'pm_mock'})) as unknown as typeof oldSub;
      client.invoices.createPreview=(async()=>({amount_due:4900,currency:'eur',period_end:Math.floor((now+86400000)/1000)})) as unknown as typeof oldPreview;
      assert.match(await nextCharge(sub),/49\.00/);
    } finally {client.subscriptions.retrieve=oldSub;client.customers.retrieve=oldCustomer;client.invoices.createPreview=oldPreview;}
    console.log('PASS C6 services: trial boundaries, reschedule/targets/tenancy, PATCH validation, edit approval reset, notifications/read, alert payload/signature/retries, expired-plan alerts, DPA acceptance and availability');
    if(process.env.C6_HTTP_URL){
      const base=process.env.C6_HTTP_URL,evidence=(process.env.VERIFY_EVIDENCE_DIR || "../work") + "/fixer6-evidence";mkdirSync(evidence,{recursive:true});
      const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
      const running=await chromium.launch({executablePath:process.env.CHROME_PATH || '/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});browser=running;
      const token=crypto.randomUUID();await db.insert(sessions).values({sessionToken:token,userId,expires:new Date(now+3600000)});
      await db.update(subscriptions).set({trialEnd:new Date(now+2*86400000)}).where(eq(subscriptions.workspaceId,workspace.id));
      const context=await running.newContext({timezoneId:'Europe/Berlin'});await context.addCookies([{name:'authjs.session-token',value:token,url:base}]);
      const page=await context.newPage();const errors:string[]=[];page.on('pageerror',(e:Error)=>errors.push(e.message));
      for(const width of [390,1280]){
        await page.setViewportSize({width,height:900});
        await page.goto(base+'/app');await page.locator('[data-trial-banner]').waitFor();assert.match(await page.locator('[data-trial-banner]').innerText(),/Europe\/Berlin/);await page.screenshot({path:`${evidence}/trial-${width}.png`,fullPage:true});
        await page.getByLabel(/Notifications: .* unread/).click();await page.getByRole('heading',{name:'Notifications',exact:true}).waitFor();const popup=await page.getByRole('heading',{name:'Notifications',exact:true}).locator('..').boundingBox();assert(popup && popup.x>=0 && popup.x+popup.width<=width);await page.screenshot({path:`${evidence}/bell-${width}.png`,fullPage:true});
        await page.goto(base+'/app/settings/notifications');await page.getByRole('heading',{name:'Alert destinations'}).waitFor();await page.screenshot({path:`${evidence}/notifications-${width}.png`,fullPage:true});
        await page.goto(base+'/app/posts/new');await page.locator('textarea[name=body]').fill('An accessible image for our client.');await page.locator('input[name=channelId]').check();
        await page.locator('input[type=file]').setInputFiles({name:'pixel.png',mimeType:'image/png',buffer:await sharp({create:{width:32,height:32,channels:3,background:'#047857'}}).png().toBuffer()});
        await page.getByLabel('Alt text for image 1').waitFor();await page.getByLabel('Alt text for image 1').fill('A small white test pixel.');assert.equal(await page.locator('textarea[name=mediaUrls]').count(),0);assert.equal(await page.getByLabel('Public HTTPS image URL').isVisible(),false);await page.getByRole('tab',{name:'mastodon'}).click();await page.locator('h1').click();await page.screenshot({path:`${evidence}/composer-${width}.png`,fullPage:true});await page.getByRole('button',{name:'Save draft',exact:true}).click();await page.waitForURL(/\/app\/posts\/[a-f0-9-]+$/);const imagePost=(await db.select().from(posts).where(eq(posts.id,page.url().split('/').at(-1)!)))[0];assert.equal(imagePost.mediaAlt[imagePost.mediaUrls[0]],'A small white test pixel.');
        await page.goto(base+'/app/brands');await page.getByLabel('Search city or timezone').fill('Tokyo');await page.getByLabel('Select timezone').selectOption('Asia/Tokyo');assert.match(await page.locator('fieldset').filter({has:page.getByLabel('Select timezone')}).innerText(),/Asia\/Tokyo/);await page.screenshot({path:`${evidence}/timezone-${width}.png`,fullPage:true});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
        for(const path of ['/','/pricing','/compare/hootsuite-alternative','/compare/postiz-alternative']){await page.goto(base+path);const box=page.locator('[data-availability]').first();await box.waitFor();assert.match(await box.innerText(),/Bluesky, Mastodon, Telegram/);assert.match(await box.innerText(),/Sign-in opens shortly/);assert(!(await page.locator('.feature-list').allTextContents()).some((s:string)=>/✓[^✓]*(?:\bX\b|Threads|LinkedIn)/.test(s)));}
      }
      await db.update(subscriptions).set({trialEnd:new Date(now-1)}).where(eq(subscriptions.workspaceId,workspace.id));await db.update(posts).set({status:'scheduled'}).where(eq(posts.id,postId));await db.update(postTargets).set({status:'held'}).where(eq(postTargets.postId,postId));
      await page.goto(base+'/app');await page.getByText('Your trial has ended').waitFor();assert.match(await page.locator('[data-trial-banner]').innerText(),/1 posts currently held/);await page.screenshot({path:evidence+'/trial-expired.png',fullPage:true});
      await db.delete(dpaAcceptances).where(eq(dpaAcceptances.workspaceId,workspace.id));await page.goto(base+'/app/settings/legal');await page.getByRole('button',{name:'Accept DPA',exact:true}).click();await page.getByRole('heading',{name:'DPA accepted'}).waitFor();assert.equal((await db.select().from(dpaAcceptances).where(eq(dpaAcceptances.workspaceId,workspace.id)))[0].userId,userId);await page.screenshot({path:evidence+'/dpa-accepted.png',fullPage:true});assert.deepEqual(errors,[]);
      console.log('PASS C6 browser: 390/1280 trial, bell, notifications, uploaded image/alt/hidden URL, preview tabs, timezone search, all availability locations, expired trial, DPA; no page errors');
    }
  }finally{await browser?.close();receiver.close();await deleteFixtureUsers(db).where(inArray(users.id,[userId,foreignId]));}
}
main().then(()=>process.exit(0)).catch(e=>{console.error('C6 verification failed:',e instanceof Error?e.message:'unknown');process.exit(1);});
