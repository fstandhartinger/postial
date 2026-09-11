import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { and, eq } from 'drizzle-orm';
import { getDb } from '../db';
import { users, workspaces, subscriptions, sessions, brands, channels, posts, postTargets, approvalDecisions, postEvents } from '../db/schema';
import { ensureWorkspace } from '../lib/workspaces';
import { encryptCredentials } from '../lib/crypto';
import { tick } from '../lib/publishing';
import { savePost } from '../lib/api/post-service';
import { publicApproval } from '../lib/approvals';

const base = process.env.VERIFY_BASE_URL!;
const evidence = process.env.VERIFY_EVIDENCE_DIR! + '/approval-evidence';
mkdirSync(evidence, { recursive: true });
const db = getDb();

async function main() {
  const uid = crypto.randomUUID(), session = crypto.randomUUID();
  const [user] = await db.insert(users).values({ id: uid, name: 'Approval E2E Agency' }).returning();
  const ws = await ensureWorkspace(uid);
  await db.insert(sessions).values({ sessionToken: session, userId: uid, expires: new Date(Date.now()+3600000) });
  await db.insert(subscriptions).values({ workspaceId: ws.id, plan: 'agency', status: 'active', stripeSubscriptionId: 'fixture-'+uid, currentPeriodEnd: new Date(Date.now()+86400000) });
  const [brand] = await db.insert(brands).values({ workspaceId: ws.id, name: 'Maple Studio', slug: 'maple-'+uid.slice(0,8), timezone: 'Europe/Berlin' }).returning();
  const [channel] = await db.insert(channels).values({ brandId: brand.id, provider: 'mastodon', displayName: 'Maple social feed', externalId: 'fixture-'+uid, credentialsEnc: encryptCredentials({ instanceUrl: 'https://fixture.invalid', accessToken: 'fixture' }) }).returning();
  const [post] = await db.insert(posts).values({ brandId: brand.id, authorUserId: uid, body: 'Maple Studio launch — review this client post.', linkUrl: 'https://example.com/launch', scheduledAt: new Date(Date.now()+60000), requiresApproval: true, approvalToken: randomBytes(32).toString('base64url'), status: 'pending_approval' }).returning();
  await db.insert(postTargets).values({ postId: post.id, channelId: channel.id, status: 'queued' });
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  try {
    const agency = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await agency.addCookies([{ name: 'authjs.session-token', value: session, url: base }]);
    const ap = await agency.newPage(); await ap.goto(`${base}/app/posts/${post.id}`); await ap.getByText('Awaiting client approval').waitFor();
    const link = await ap.getByLabel('Client approval link').inputValue(); assert.match(link, /\/r\/[A-Za-z0-9_-]{43}$/);
    const token = link.split('/').pop()!;
    for (const [ctx, width] of [[await browser.newContext({ viewport: {width:390,height:844} }),390], [await browser.newContext({ viewport: {width:1280,height:900} }),1280]] as const) {
      const page = await ctx.newPage(); const html = await (await page.goto(link))!.text();
      assert.match(html, /Maple Studio/); assert.match(html, /Maple Studio launch/); assert.match(html, /Mastodon/); assert.match(html, /Approve/); assert(!html.includes(post.id)); assert(!html.includes(ws.id)); assert(!html.includes(uid));
      await page.screenshot({ path: `${evidence}/client-review-${width}.png`, fullPage: true }); await ctx.close();
    }
    const client = await browser.newContext({ viewport: {width:390,height:844} }); const cp = await client.newPage(); await cp.goto(link);
    await cp.getByLabel('Name (required)').fill('Anna Client'); await cp.getByLabel('Comment (required when requesting changes)').fill('Please shorten the opening.'); await Promise.all([cp.waitForNavigation(), cp.getByRole('button', { name: 'Request changes' }).click()]);
    await cp.getByText('Thank you. Your decision has been saved.').waitFor();
    assert.equal((await db.select().from(posts).where(eq(posts.id,post.id)))[0].status, 'changes_requested');
    await ap.reload(); await ap.getByRole('status').filter({hasText:'Changes requested'}).first().waitFor(); await ap.getByText('Please shorten the opening.').first().waitFor();
    await Promise.all([ap.waitForURL(/\/app\/posts\/.+\/edit$/), ap.getByRole('link', {name:'Edit post'}).click()]); await ap.getByLabel('Post text').fill('Maple Studio launch — approved revision.');
    await Promise.all([
      // Anchored on purpose: we click from /app/posts/<id>/edit, and the loose pattern
      // /\/app\/posts\// already matched that URL, so this wait resolved immediately and the
      // status assertion below raced a page that was still navigating. That is the timeout
      // seen in cycles 70 and 75.
      ap.waitForURL(/\/app\/posts\/[^/]+$/, { waitUntil: 'networkidle' }),
      ap.getByRole('button', {name:'Schedule'}).click(),
    ]);
    await ap.getByRole('status').filter({hasText:'Post saved for client approval'}).waitFor();
    const revised = (await db.select().from(posts).where(eq(posts.id,post.id)))[0]; assert.equal(revised.status,'pending_approval'); assert.equal(revised.requiresApproval,true); assert.equal(revised.approvalToken, token); const fresh = `${base}/r/${token}`;
    const events = await db.select().from(postEvents).where(eq(postEvents.postId,post.id)); assert(events.some(e => e.message === 'Client Anna Client requested changes: Please shorten the opening.')); assert(events.some(e => e.message === 'Edited content resubmitted for client approval'));
    await ap.goto(`${base}/app/approvals`); await ap.getByRole('region', {name:/Awaiting/}).getByText(/Maple Studio/).waitFor(); assert.equal(await ap.getByRole('region', {name:/Changes requested/}).getByText(/Maple Studio/).count(), 0);
    const before = await fetch(fresh); assert.equal(before.status,200); const beforeHtml = await before.text(); assert.match(beforeHtml, /Awaiting your review after resubmission/); assert(!beforeHtml.includes('Changes requested by'));
    const client2 = await browser.newContext({ viewport: {width:390,height:844} }); const cp2 = await client2.newPage(); await cp2.goto(fresh); await cp2.getByLabel('Name (required)').fill('Anna Client'); await Promise.all([cp2.waitForNavigation(), cp2.getByRole('button',{name:'Approve'}).click()]); await cp2.getByText('Thank you. Your decision has been saved.').waitFor();
    const approved = (await db.select().from(posts).where(eq(posts.id,post.id)))[0]; assert.equal(approved.status,'approved'); await ap.reload(); await ap.getByText('Approved').first().waitFor();
    await db.update(posts).set({ scheduledAt: new Date(Date.now()-1000) }).where(eq(posts.id,post.id)); await db.update(postTargets).set({ nextAttemptAt: new Date(Date.now()-1000) }).where(eq(postTargets.postId,post.id)); await tick();
    assert.equal((await db.select().from(posts).where(eq(posts.id,post.id)))[0].status,'published');
    const publishedApproval = await publicApproval(token); assert(publishedApproval);
    assert.equal((await (await fetch(fresh)).status),200); assert.equal((await fetch(fresh, {method:'POST',headers:{Origin:base,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({reviewerName:'Double',decision:'approved',comment:'',approvalVersion:publishedApproval.approvalVersion})})).status,409);
    assert.equal((await fetch(`${base}/r/${token}`)).status,200); assert.equal((await fetch(`${base}/r/${token.slice(0,-1)+'x'}`)).status,404);
    const [a,b] = await Promise.all([fetch(fresh), fetch(fresh)]); assert.equal(a.status,200); assert.equal(b.status,200);
    assert.equal((await db.select().from(approvalDecisions).where(eq(approvalDecisions.postId,post.id))).length,2);
    const draftForm = new FormData(); draftForm.set('brandId', brand.id); draftForm.set('body', 'Maple Studio draft after resubmit coverage.'); draftForm.set('intent', 'draft'); draftForm.append('channelId', channel.id); draftForm.set('requiresApproval', 'on');
    const draftId = await savePost({ db, workspace: ws, userId: uid }, draftForm, true); const draft = (await db.select().from(posts).where(eq(posts.id, draftId)))[0]; assert.equal(draft.status, 'draft');
    console.log('PASS approval E2E: anonymous review, revision, approval, publish, replay/tamper/forward/double-open checks');
  } finally { await browser.close(); await db.delete(workspaces).where(eq(workspaces.id,ws.id)); await db.delete(users).where(eq(users.id,uid)); await db.$client.end(); }
}
main().catch(e=>{ console.error(e instanceof Error ? e.message : 'approval E2E failed'); process.exit(1); });
