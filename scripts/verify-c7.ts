// Shared origin takes precedence; historical per-script variables remain supported.
if (process.env.VERIFY_BASE_URL) process.env.C7_HTTP_URL = process.env.VERIFY_BASE_URL;
import { stripe } from '../lib/stripe';
import { actionBodyLimit } from '../lib/http/action-limit';
import { readFileSync, mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createCipheriv, randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { eq, inArray, sql } from 'drizzle-orm';
import { getDb } from '../db';
import { users, workspaces, workspaceMembers, subscriptions, brands, channels, posts, postTargets, accounts, sessions, postEvents, webhookEndpoints, webhookDeliveries, maintenanceRuns, notifications, oauthStates, workspaceInvites } from '../db/schema';
import { mediaAssets } from '../db/media-schema';
import { createApiKey } from '../lib/api/auth';
import { GET as postGet } from '../app/api/v1/posts/[id]/route';
import { POST as postCreate } from '../app/api/v1/posts/route';
import { POST as webhook } from '../app/api/stripe/webhook/route';
import { GET as approvalGet } from '../app/r/[token]/route';
import { publicApproval } from '../lib/approvals';
import { GET as mediaGet } from '../app/m/[id]/route';
import { GET as health } from '../app/healthz/route';
import { readBody } from '../lib/http/body';
import { deleteAccount, deleteWorkspace, exportWorkspace, transferOwnership } from '../lib/offboarding';
import { decryptCredentials, encryptCredentials } from '../lib/crypto';
import { reencrypt } from '../lib/reencrypt';
import { retainMedia } from '../lib/media/retention';
import { identityOnlyAdapter } from '../lib/auth-adapter';
import { DrizzleAdapter } from '@auth/drizzle-adapter';
import { normalizeEmail } from '../lib/auth-email';
import Nodemailer from 'next-auth/providers/nodemailer';
import { sendPostialVerificationRequest, SIGN_IN_LINK_MAX_AGE_SECONDS } from '../lib/auth-email';
import { cleanText, linkInput, visibleIdentifier } from '../lib/text-input';
import { workerState } from '../lib/publishing/state';
import { deleteFixtureUsers } from './fixture-cleanup';
import { sendTestEvent } from '../lib/api/webhooks';
import { checkChannelHealth } from '../lib/publishing/health';
import { registerPublisher } from '../lib/publishers';
const db=getDb(), user=randomUUID(), other=randomUUID(), workspaceId=randomUUID(), brandId=randomUUID(), channelId=randomUUID(), postId=randomUUID();
const token=randomBytes(32).toString('base64url'), asset=randomBytes(32).toString('base64url');
const originalRing=process.env.APP_ENCRYPTION_KEYS, originalTrust=process.env.APPROVAL_TRUST_PROXY;
const day=86400000, ago=(n:number)=>new Date(Date.now()-n*day);
async function main() {
  assert(process.env.APP_ENCRYPTION_KEY,'Set the existing legacy read key for verification.');
  process.env.APPROVAL_TRUST_PROXY='true';
  const request=(url:string,init:RequestInit={})=>new Request('http://localhost'+url,init);
  const [previous]=await db.select().from(maintenanceRuns).where(eq(maintenanceRuns.name,'media_retention'));
  try {
    await db.insert(users).values([{id:user,name:'C7 owner',email:user+'@fixture.postial.invalid'},{id:other,name:'C7 successor',email:other+'@fixture.postial.invalid'}]);
    await db.insert(workspaces).values({id:workspaceId,name:'fixture:C7',slug:user,ownerUserId:user});
    await db.insert(workspaceMembers).values([{workspaceId,userId:user,role:'owner'},{workspaceId,userId:other,role:'editor'}]);
    await db.insert(subscriptions).values({workspaceId,plan:'agency',status:'active',stripeSubscriptionId:'sub_fixture_'+user,currentPeriodEnd:new Date(Date.now()+day)});
    await db.insert(brands).values({id:brandId,workspaceId,name:'C7',slug:user});
    const enc=encryptCredentials({token:'synthetic-channel-secret'});
    await db.insert(channels).values({id:channelId,brandId,provider:'mastodon',externalId:'fixture',displayName:'C7',credentialsEnc:enc});
    await db.insert(posts).values({id:postId,brandId,authorUserId:user,body:'C7',requiresApproval:true,approvalToken:token,status:'pending_approval',scheduledAt:new Date(Date.now()+day)});
    await db.insert(postTargets).values({postId,channelId});
    const read=await createApiKey(workspaceId,user,'Read',['posts:read']);
    const write=await createApiKey(workspaceId,user,'Write',['posts:read','posts:write']);
    const get=async(key:string)=> (await postGet(request('/api/v1/posts/'+postId,{headers:{authorization:'Bearer '+key}}),{params:Promise.resolve({id:postId})})).json();
    const reading=await get(read.token);
    assert(!('approval_url' in reading));assert(!JSON.stringify(reading).includes(token));assert(Array.isArray(reading.approvals));
    assert.match((await get(write.token)).approval_url,new RegExp('/r/'+token+'$'));
    console.log('S01 read-only response omits capability; write scope receives link');
    if(process.env.C7_HTTP_URL) {
      const base=process.env.C7_HTTP_URL, ip='2001:db8:'+randomBytes(2).toString('hex')+':'+randomBytes(2).toString('hex')+'::1';
      const readResponse=await fetch(base+'/api/v1/posts/'+postId,{headers:{authorization:'Bearer '+read.token}});
      assert.equal(readResponse.status,200);const safe=await readResponse.text();assert(!safe.includes(token));assert(!safe.includes('approval_url'));
      const approved=await fetch(base+'/r/'+token,{method:'POST',headers:{origin:base,'content-type':'application/x-www-form-urlencoded','x-real-ip':ip},body:new URLSearchParams({decision:'approved',reviewerName:'C7 client',comment:'',approvalVersion:(await publicApproval(token))!.approvalVersion})});
      assert.equal(approved.status,200);assert.equal((await db.select().from(posts).where(eq(posts.id,postId)))[0].status,'approved');
      for(let i=1;i<=60;i++) {
        const r=await fetch(base+'/r/'+token,{headers:{'x-real-ip':ip}});
        assert.equal(r.status,i===60?429:200);await r.arrayBuffer();
      }
      console.log('Built HTTP: read-only omits token, anonymous client POST approves, 61st /r request is 429');
    }

    let consumed=false;
    const oversized=request('/api/stripe/webhook',{method:'POST',headers:{'content-length':String(600*1024),'stripe-signature':'invalid'},body:new ReadableStream({pull(c){consumed=true;c.close();}}),duplex:'half'} as RequestInit);
    const response=await webhook(oversized);assert.equal(response.status,413);
    // Content-Length check runs before getReader (the source itself may pre-pull).
    void consumed;
    assert.equal((await webhook(request('/api/stripe/webhook',{method:'POST',body:'x'.repeat(600*1024)}))).status,413);
    await assert.rejects(()=>readBody(request('/slow',{method:'POST',body:new ReadableStream({pull(){return new Promise(()=>{});}}),duplex:'half'} as RequestInit),64,25),(e:{status:number})=>e.status===408);
    await assert.rejects(()=>readBody(request('/chunked',{method:'POST',body:'x'.repeat(65)}),64),(e:{status:number})=>e.status===413);
    console.log('S02 webhook 600 KiB is 413 before signature; real stream cap and stalled deadline pass');
    assert.equal(await actionBodyLimit(request('/app/posts/bulk',{headers:{'next-action':'a'.repeat(40)}})),64*1024);
    if(process.env.C7_HTTP_URL) {
      const entries=JSON.parse(readFileSync('.next/server/server-reference-manifest.json','utf8')).node;
      const action=Object.entries(entries).find(([,v])=>(v as {exportedName:string}).exportedName==='saveBulkAction')?.[0];
      assert(action);assert.equal(await actionBodyLimit(request('/app/posts/bulk',{headers:{'next-action':action}})),2*1024*1024);
      const tooBig=await fetch(process.env.C7_HTTP_URL+'/app/posts/bulk',{method:'POST',headers:{'next-action':'a'.repeat(40)},body:'x'.repeat(65*1024)});assert.equal(tooBig.status,413);
      const sessionToken=randomUUID();await db.insert(sessions).values({userId:user,sessionToken,expires:new Date(Date.now()+day)});
      const bulk=await fetch(process.env.C7_HTTP_URL+'/app/posts/bulk',{method:'POST',headers:{'next-action':action,origin:process.env.C7_HTTP_URL,'content-type':'text/plain;charset=UTF-8',cookie:'authjs.session-token='+sessionToken},body:JSON.stringify([brandId,[{text:'x'.repeat(66*1024),channelIds:[],scheduledAt:'',imageUrl:'',requiresApproval:false}],true])});
      assert.equal(bulk.status,200);const bulkResult=await bulk.text();
      assert(!(await db.select().from(posts).where(eq(posts.brandId,brandId))).some(p=>p.body.length===66*1024));
      assert.match(bulkResult,/validation|10.?000|limit/i);
      console.log('Built HTTP: ordinary action 65 KiB rejected; identified bulk action accepts the request but rejects the overlong row');

    }

    const ip='2001:db8:'+randomBytes(2).toString('hex')+':'+randomBytes(2).toString('hex')+'::1';
    for(let i=0;i<61;i++) {
      const r=await approvalGet(request('/r/'+token,{headers:{'x-real-ip':ip}}),{params:Promise.resolve({token})});
      assert.equal(r.status,i===60?429:200);
      if(i===60) assert(Number(r.headers.get('retry-after'))>0);
    }
    await Promise.all(Array.from({length:18},(_,i)=>createApiKey(workspaceId,user,'Key '+i,['posts:read'])));
    await assert.rejects(()=>createApiKey(workspaceId,user,'21',['posts:read']),(e:{status:number})=>e.status===422);
    const [endpoint]=await db.insert(webhookEndpoints).values({workspaceId,url:'https://example.com/webhook',secretHash:'fixture',secretEnc:encryptCredentials({secret:'synthetic-webhook'}),events:['post.published']}).returning();
    for(let i=0;i<10;i++) await sendTestEvent(workspaceId,endpoint.id);
    await assert.rejects(()=>sendTestEvent(workspaceId,endpoint.id),(e:{status:number})=>e.status===429);
    let entered!:()=>void, release!:()=>void;
    const entry=new Promise<void>(r=>{entered=r;}), wait=new Promise<void>(r=>{release=r;});
    registerPublisher({provider:'mastodon',credentialFields:[],maxMediaBytes:16000000,maxTextLength:500,
      async validate(){entered();await wait;return {externalId:'fixture',displayName:'C7'};},async publish(){throw new Error('No publishing in C7');}});
    const checking=checkChannelHealth(channelId,workspaceId);await entry;
    await db.transaction(async tx=>{await tx.execute(sql`set local lock_timeout='500ms'`);await tx.update(channels).set({credentialsEnc:encryptCredentials({token:'reconnected'})}).where(eq(channels.id,channelId));});
    release();await checking;
    const [reconnected]=await db.select().from(channels).where(eq(channels.id,channelId));
    assert.equal(decryptCredentials(reconnected.credentialsEnc).token,'reconnected');
    console.log('S03 anonymous 61st request 429, concurrent key cap 20, test budget 10/h, health I/O outside locks and fenced');
    await db.insert(mediaAssets).values({id:asset,workspaceId,uploaderUserId:user,mime:'image/png',bytes:4,width:1,height:1,sha256:'fixture',data:Buffer.from('test')});
    const exported=JSON.stringify(await exportWorkspace(workspaceId,user));
    for(const forbidden of ['credentialsEnc','synthetic-channel-secret','secretEnc','approvalToken',token,'access_token']) assert(!exported.includes(forbidden));
    await assert.rejects(()=>exportWorkspace(workspaceId,other),(e:{status:number})=>e.status===403);
    await assert.rejects(()=>deleteAccount(user,'DELETE'),(e:{code:string})=>e.code==='last_owner');
    await assert.rejects(()=>deleteWorkspace(workspaceId,user,'wrong',async()=>{}),(e:{status:number})=>e.status===422);
    await assert.rejects(()=>deleteWorkspace(workspaceId,other,'fixture:C7',async()=>{}),(e:{status:number})=>e.status===403);
    console.log('S04 owner-only export has no credentials, last-owner and typed deletion confirmation enforced');
    if(process.env.C7_HTTP_URL && process.env.PLAYWRIGHT_MODULE) {
      const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
      const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH || '/usr/bin/google-chrome',args:['--no-sandbox']});
      const sessionToken=randomUUID();await db.insert(sessions).values({userId:user,sessionToken,expires:new Date(Date.now()+day)});
      const evidence=(process.env.VERIFY_EVIDENCE_DIR || "../work") + "/fixer7-evidence/offboarding";mkdirSync(evidence,{recursive:true});
      try {
        for(const width of [390,1280]) {
          const context=await browser.newContext({viewport:{width,height:900}});
          await context.addCookies([{name:'authjs.session-token',value:sessionToken,url:process.env.C7_HTTP_URL}]);
          const page=await context.newPage();const errors:string[]=[];page.on('pageerror',(e:Error)=>errors.push(e.message));
          await page.goto(process.env.C7_HTTP_URL+'/app/settings/workspace');
          await page.getByRole('heading',{name:'Workspace settings',exact:true}).waitFor();
          const download=page.waitForEvent('download');await page.getByRole('link',{name:'Export data',exact:true}).click();
          const file=await download;const downloadPath=await file.path();assert(downloadPath);const data=readFileSync(downloadPath,'utf8');assert(!data.includes('credentialsEnc'));assert(!data.includes(token));
          await page.getByRole('textbox').fill('wrong name');await page.getByRole('button',{name:'Delete workspace',exact:true}).click();
          await page.getByRole('alert').filter({hasText:'exact workspace name'}).waitFor();
          await page.screenshot({path:evidence+'/workspace-'+width+'.png',fullPage:true});
          await page.goto(process.env.C7_HTTP_URL+'/app/settings/account');
          await page.getByRole('textbox').fill('DELETE');await page.getByRole('button',{name:'Delete my account',exact:true}).click();
          await page.getByRole('alert').filter({hasText:'last owner'}).waitFor();
          await page.screenshot({path:evidence+'/account-'+width+'.png',fullPage:true});
          assert.deepEqual(errors,[]);await context.close();
        }
      } finally {await browser.close();}
      console.log('S04 browser 390/1280: private export download, typed workspace guard and last-owner account guard pass');
    }

    assert.match(enc,/^v1:k0:/);
    const iv=randomBytes(12), cipher=createCipheriv('aes-256-gcm',Buffer.from(process.env.APP_ENCRYPTION_KEY!,'base64'),iv);
    const ciphertext=Buffer.concat([cipher.update(JSON.stringify({token:'legacy'})),cipher.final()]);
    const legacy=[iv,cipher.getAuthTag(),ciphertext].map(b=>b.toString('base64')).join('.');
    process.env.APP_ENCRYPTION_KEYS='rotation:'+randomBytes(32).toString('base64');
    assert.equal(decryptCredentials(legacy).token,'legacy');assert.equal(decryptCredentials(enc).token,'synthetic-channel-secret');
    assert.match(encryptCredentials({token:'new'}),/^v1:rotation:/);
    const rollback=new Error('test rollback');
    await assert.rejects(()=>db.transaction(async tx=>{
      await tx.update(channels).set({credentialsEnc:legacy}).where(eq(channels.id,channelId));
      const result=await reencrypt(tx);assert(result.count>=1);assert.equal((await reencrypt(tx)).count,0);
      const [row]=await tx.select().from(channels).where(eq(channels.id,channelId));assert.match(row.credentialsEnc,/^v1:rotation:/);assert.equal(decryptCredentials(row.credentialsEnc).token,'legacy');
      throw rollback;
    }),e=>e===rollback);
    if(originalRing===undefined) delete process.env.APP_ENCRYPTION_KEYS;else process.env.APP_ENCRYPTION_KEYS=originalRing;
    assert.equal(decryptCredentials((await db.select().from(channels).where(eq(channels.id,channelId)))[0].credentialsEnc).token,'reconnected');
    console.log('S06 v1, legacy read, rotation, idempotence and transaction rollback pass; existing ciphertext preserved');
    const child=spawnSync(process.execPath,['--import','tsx','-e',"require('./lib/config.ts').validateConfig()"],{env:{...process.env,CRON_SECRET:'',NEXT_PHASE:''},encoding:'utf8'});
    assert.notEqual(child.status,0);assert.match(child.stderr,/CRON_SECRET/);
    if(process.env.C7_HTTP_URL) {
      const startup=spawnSync(process.execPath,['.next/standalone/server.js'],{env:{...process.env,CRON_SECRET:'',PORT:'4192',HOSTNAME:'127.0.0.1'},encoding:'utf8',timeout:15000});
      assert.notEqual(startup.status,0);assert(!startup.error,'Missing CRON must exit, not hang');assert.match(startup.stderr+startup.stdout,/CRON_SECRET/);
    }

    const h=await health(request('/healthz',{headers:{'x-real-ip':'198.51.100.253'}}));assert.equal(h.status,200);
    const healthData=await h.json();assert(healthData.migrations.applied>=19);assert.match(healthData.migrations.latest,/0019/);assert('lastTickAt' in healthData.worker);assert(!('errorsLastHour' in healthData));
    const oldWorker=workerState.lastTickAt, oldEnabled=process.env.WORKER_ENABLED;
    process.env.WORKER_ENABLED='true';workerState.lastTickAt=ago(1).toISOString();assert.equal((await health()).status,503);
    process.env.WORKER_ENABLED='false';assert.equal((await health()).status,200);workerState.lastTickAt=oldWorker;
    if(oldEnabled===undefined) delete process.env.WORKER_ENABLED; else process.env.WORKER_ENABLED=oldEnabled;
    console.log('S07 missing CRON exits, migration and worker health fields, stale worker 503/disabled 200 pass');
    let mailCount=0;
    const provider=Nodemailer({server:{host:'unused'},maxAge:SIGN_IN_LINK_MAX_AGE_SECONDS}); provider.sendVerificationRequest=sendPostialVerificationRequest;
    provider.server={name:'fixture',version:'1',send(mail:{data:Record<string,unknown>},callback:(e:null,result:unknown)=>void){
      const d=mail.data;assert.equal(d.to,'review@example.invalid');assert(!('raw' in d));assert(!('resolveContent' in d));assert.match(String(d.text),/fixture-token/);assert.match(String(d.html),/Sign in to Postial/);assert.equal(d.subject,'Your Postial sign-in link');mailCount++;
      callback(null,{accepted:['review@example.invalid'],rejected:[],pending:[]});
    }} as unknown as typeof provider.server;
    await provider.sendVerificationRequest({identifier:'review@example.invalid',url:'https://socialmint.example/api/auth/callback/nodemailer?token=fixture-token',provider,theme:{},token:'fixture-token',expires:new Date(Date.now()+60000),request:request('/mail')} as Parameters<typeof provider.sendVerificationRequest>[0]);
    assert.equal(mailCount,1);assert.throws(()=>normalizeEmail('a'.repeat(10000)));assert.throws(()=>normalizeEmail('a@b@c.example'));assert.equal(normalizeEmail('Review@Example.Invalid'),'review@example.invalid');
    console.log('S08 actual Auth.js message through mocked transport, fixed content, bounded email pass');
    const bad=await postCreate(request('/api/v1/posts',{method:'POST',headers:{authorization:'Bearer '+write.token,'content-type':'application/json'},body:JSON.stringify({brand_id:brandId,body:'hi',link_url:'https://exam\u200Bple.com'})}));assert.equal(bad.status,422);
    assert.throws(()=>linkInput('https://example.com/'+'a'.repeat(2048)));assert.throws(()=>linkInput('javascript:alert(1)'));
    assert.throws(()=>visibleIdentifier('name\u202E'));assert.equal(cleanText('hello\u202E world'),'hello world');assert.equal(linkInput('HTTP://EXAMPLE.COM'),'http://example.com/');
    const adapter=identityOnlyAdapter(DrizzleAdapter(db,{usersTable:users,accountsTable:accounts,sessionsTable:sessions}));
    await adapter.linkAccount!({userId:user,type:'oauth',provider:'google',providerAccountId:user,access_token:'synthetic-access',refresh_token:'synthetic-refresh',id_token:'synthetic-id'});
    const [account]=await db.select().from(accounts).where(eq(accounts.userId,user));assert.equal(account.access_token,null);assert.equal(account.refresh_token,null);assert.equal(account.id_token,null);
    const [tokens]=await db.execute(sql`select count(*)::integer as n from accounts where access_token is not null or refresh_token is not null or id_token is not null`);assert.equal(tokens.n,0);
    console.log('S10 unicode/URL 422 and text cleaning; S11 adapter and existing DB accounts token-free');
    const [oldDelivery]=await db.insert(webhookDeliveries).values({endpointId:endpoint.id,event:'ping',payload:{},createdAt:ago(31)}).returning();
    const [oldNotification]=await db.insert(notifications).values({workspaceId,type:'fixture',message:'expired',createdAt:ago(91)}).returning();
    const state=randomUUID();await db.insert(oauthStates).values({state,codeVerifier:encryptCredentials({verifier:'fixture'}),brandId,userId:user,provider:'x',expiresAt:ago(2)});
    const [invite]=await db.insert(workspaceInvites).values({workspaceId,role:'editor',invitedEmail:'invitee@example.invalid',tokenHash:randomUUID(),createdBy:user,expiresAt:ago(31)}).returning();
    await db.execute(sql`insert into request_rate_limits values (${'c7:'+user},1,${ago(2).toISOString()}::timestamptz)`);
    await db.insert(maintenanceRuns).values({name:'media_retention',completedAt:new Date(0)}).onConflictDoUpdate({target:maintenanceRuns.name,set:{completedAt:new Date(0)}});
    await retainMedia();
    assert.equal((await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.id,oldDelivery.id))).length,0);
    assert.equal((await db.select().from(notifications).where(eq(notifications.id,oldNotification.id))).length,0);
    assert.equal((await db.select().from(oauthStates).where(eq(oauthStates.state,state))).length,0);
    assert.equal((await db.select().from(workspaceInvites).where(eq(workspaceInvites.id,invite.id))).length,0);
    assert.equal((await db.execute(sql`select 1 from request_rate_limits where key=${'c7:'+user}`)).length,0);
    console.log('S05 retention removes deliveries/notifications/rate/invite/OAuth fixtures');
    await db.insert(sessions).values({userId:user,sessionToken:randomUUID(),expires:new Date(Date.now()+day)});
    await db.insert(postEvents).values({postId,type:'fixture',message:'By '+user+'@fixture.postial.invalid'});
    await transferOwnership(workspaceId,user,other);
    await deleteAccount(user,'DELETE');
    assert.equal((await db.select().from(users).where(eq(users.id,user))).length,0);
    assert.equal((await db.select().from(accounts).where(eq(accounts.userId,user))).length,0);
    assert.equal((await db.select().from(sessions).where(eq(sessions.userId,user))).length,0);
    assert.equal((await db.select().from(posts).where(eq(posts.id,postId)))[0].authorUserId,null);
    assert.equal((await db.select().from(mediaAssets).where(eq(mediaAssets.id,asset)))[0].uploaderUserId,null);
    assert(!JSON.stringify(await exportWorkspace(workspaceId,other)).includes(user+'@fixture.postial.invalid'));
    await assert.rejects(()=>deleteWorkspace(workspaceId,other,'fixture:C7',async()=>{throw Error('mock Stripe outage');}));
    assert.equal((await db.select().from(workspaces).where(eq(workspaces.id,workspaceId))).length,1);
    let cancellations=0;const client=stripe(), cancel=client.subscriptions.cancel;
    client.subscriptions.cancel=(async(id:string,options:unknown)=>{assert.equal(id,'sub_fixture_'+user);assert.deepEqual(options,{invoice_now:false,prorate:false});cancellations++;return {id,status:'canceled'};}) as typeof client.subscriptions.cancel;
      try { await deleteWorkspace(workspaceId,other,'fixture:C7'); } finally { client.subscriptions.cancel=cancel; }
    assert.equal(cancellations,1);
    for(const table of ['brands','api_keys','webhook_endpoints','workspace_invites','media_assets','workspace_members','subscriptions'])
      assert.equal((await db.execute(sql`select 1 from ${sql.identifier(table)} where workspace_id=${workspaceId}::uuid`)).length,0);
    assert.equal((await db.select().from(posts).where(eq(posts.id,postId))).length,0);
    assert.equal((await db.select().from(channels).where(eq(channels.id,channelId))).length,0);
    assert.equal((await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.endpointId,endpoint.id))).length,0);
    assert.equal((await mediaGet(request('/m/'+asset),{params:Promise.resolve({id:asset})})).status,410);
    console.log('S04/S05 transfer + account preserves shared content, workspace cascade + mocked cancellation/retry + media 410 pass');
    if(process.env.C7_HTTP_URL) {
      const base=process.env.C7_HTTP_URL;
      assert.equal((await fetch(base+'/api/stripe/webhook',{method:'POST',body:'x'.repeat(600*1024)})).status,413);
      const r=await fetch(base+'/healthz');assert.equal(r.status,200);const d=await r.json();assert(d.migrations.applied>=15);assert('ageSeconds' in d.worker);
      console.log('Built HTTP webhook/health smoke pass');
    }
  } finally {
    if(originalRing===undefined) delete process.env.APP_ENCRYPTION_KEYS;else process.env.APP_ENCRYPTION_KEYS=originalRing;
    if(originalTrust===undefined) delete process.env.APPROVAL_TRUST_PROXY;else process.env.APPROVAL_TRUST_PROXY=originalTrust;
    await deleteFixtureUsers(db).where(inArray(users.id,[user,other]));
    await db.execute(sql`delete from workspace_deletions where workspace_id=${workspaceId}::uuid`);
    await db.execute(sql`delete from offboarding_events where workspace_id=${workspaceId}::uuid`);
    await db.execute(sql`delete from media_tombstones where id=${asset}`);
    await db.execute(sql`delete from request_rate_limits where key=${'webhook-test:'+workspaceId}`);
    if(previous) await db.update(maintenanceRuns).set({completedAt:previous.completedAt}).where(eq(maintenanceRuns.name,'media_retention'));
    else await db.delete(maintenanceRuns).where(eq(maintenanceRuns.name,'media_retention'));
  }
}
main().then(()=>{console.log('PASS C7');process.exit(0);}).catch(e=>{console.error('C7 failure location:', e instanceof Error ? e.stack?.split('\n').filter(l=>l.trim().startsWith('at ')).slice(0,4).join('\n') : ''); console.error('C7 failed:',e instanceof assert.AssertionError?e.message:e instanceof Error?e.constructor.name:'Unknown');process.exit(1);});
