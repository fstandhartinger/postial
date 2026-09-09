import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { getDb } from '../db';
import { users, brands, channels, posts, postTargets, subscriptions, approvalDecisions } from '../db/schema';
import { ensureWorkspace } from '../lib/workspaces';
import { encryptCredentials, decryptCredentials } from '../lib/crypto';
import { registerPublisher, PublishError } from '../lib/publishers';
import { checkChannelHealth } from '../lib/publishing/health';
import { listApprovals, newApprovalToken } from '../lib/approvals';
import { duplicatePost } from '../lib/api/post-service';
import { verifyRetention } from './verify-retention';
async function main() {
  const db=getDb(),userId=crypto.randomUUID(); let calls=0;
  registerPublisher({provider:'mastodon',maxTextLength:500,maxMediaBytes:1000,credentialFields:[],
    async validate(){calls++;throw new PublishError({code:'AUTH_EXPIRED',humanMessage:'must not be logged: fixture private text',retryable:false});},
    async publish(){throw new Error('Must not publish');}});
  try {
    await db.insert(users).values({id:userId});const workspace=await ensureWorkspace(userId);
    await db.insert(subscriptions).values({workspaceId:workspace.id,plan:'agency',status:'active',stripeSubscriptionId:'pilot-'+userId,currentPeriodEnd:new Date(Date.now()+86400000)});
    const [brand]=await db.insert(brands).values({workspaceId:workspace.id,name:'Pilot',slug:userId}).returning();
    const cs=await db.insert(channels).values(Array.from({length:7},(_,i)=>({brandId:brand.id,provider:'mastodon' as const,displayName:'Fake',externalId:String(i),credentialsEnc:encryptCredentials({token:'fake'}),status:i===6?'disconnected' as const:'active' as const,lastCheckedAt:null}))).returning();
    assert.equal((await checkChannelHealth(undefined,workspace.id)).checked,5);assert.equal(calls,5);
    assert.equal((await checkChannelHealth(undefined,workspace.id)).checked,1);assert.equal(calls,6);
    assert.equal((await checkChannelHealth(undefined,workspace.id)).checked,0);assert.equal(calls,6);
    const checked=await db.select().from(channels).where(eq(channels.brandId,brand.id));
    assert.equal(checked.filter(c=>c.status==='token_expired'&&c.lastCheckedAt).length,6);
    assert.equal(checked.find(c=>c.id===cs[6].id)?.lastCheckedAt,null);
    await db.update(channels).set({lastCheckedAt:new Date(Date.now()-86400001)}).where(eq(channels.id,cs[0].id));
    assert.equal((await checkChannelHealth(undefined,workspace.id)).checked,1);
    registerPublisher({provider:'mastodon',maxTextLength:500,maxMediaBytes:1000,credentialFields:[],
      async refreshCredentials(){return {token:'renewed-fixture'};},
      async validate(credentials){calls++;assert.equal(credentials.token,'renewed-fixture');return {externalId:'fake',displayName:'Fake'};},
      async publish(){throw new Error('Must not publish');}});
    await db.update(channels).set({lastCheckedAt:new Date(0)}).where(eq(channels.id,cs[0].id));
    const concurrent=await Promise.all([checkChannelHealth(undefined,workspace.id),checkChannelHealth(undefined,workspace.id)]);
    assert.equal(concurrent.reduce((sum,r)=>sum+r.checked,0),1);
    const [renewed]=await db.select().from(channels).where(eq(channels.id,cs[0].id));
    assert.equal(renewed.status,'active');assert.equal(renewed.lastHealthError,null);assert.equal(decryptCredentials(renewed.credentialsEnc).token,'renewed-fixture');
    const fixtures=await db.insert(posts).values((['pending_approval','changes_requested','approved','published'] as const).map(status=>({brandId:brand.id,authorUserId:userId,body:'Pilot text',mediaUrls:['https://example.com/image.png'],linkUrl:'https://example.com',scheduledAt:new Date(Date.now()+86400000),status,requiresApproval:true,approvalToken:newApprovalToken()}))).returning();
    await db.insert(approvalDecisions).values({postId:fixtures[1].id,decision:'changes_requested',comment:'Shorten this',reviewerName:'Client',reviewerIpHash:'fake'});
    const groups=await listApprovals(workspace.id);assert.deepEqual(groups.map(g=>g.rows.length),[1,1,1,1]);assert.equal(groups[1].rows[0].lastDecision?.comment,'Shorten this');
    assert.deepEqual((await listApprovals(workspace.id,crypto.randomUUID())).map(g=>g.rows.length),[0,0,0,0]);
    const source=fixtures[3];await db.insert(postTargets).values({postId:source.id,channelId:cs[0].id,status:'published',attempts:3,publishedAt:new Date(),remoteId:'remote'});
    const copyId=await duplicatePost({db,workspace,userId},source.id);const [copy]=await db.select().from(posts).where(eq(posts.id,copyId));
    for(const key of ['body','mediaUrls','brandId','linkUrl'] as const) assert.deepEqual(copy[key],source[key]);
    assert.equal(copy.status,'draft');assert.equal(copy.scheduledAt,null);assert.equal(copy.approvalToken,null);assert.equal(copy.requiresApproval,false);
    const [target]=await db.select().from(postTargets).where(eq(postTargets.postId,copyId));assert.equal(target.channelId,cs[0].id);assert.equal(target.attempts,0);assert.equal(target.remoteId,null);assert.equal(target.nextAttemptAt,null);
    await assert.rejects(duplicatePost({db,workspace:{id:crypto.randomUUID()},userId},source.id));
    await verifyRetention(); console.log('Pilot: health auth/24h/budget/disconnected, approval groups/filter/decision, duplicate fields/draft/tenancy passed');
  } finally {await db.delete(users).where(eq(users.id,userId));}
}
main().then(()=>process.exit(0)).catch(()=>{console.error('Pilot verification failed');process.exit(1);});
