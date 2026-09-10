import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { getDb } from '../db';
import { users, subscriptions, brands, channels, posts, postTargets } from '../db/schema';
import { billingState } from '../db/billing-schema';
import { ensureWorkspace } from '../lib/workspaces';
import { encryptCredentials } from '../lib/crypto';
import { registerPublisher } from '../lib/publishers';
import { tick } from '../lib/publishing';
import { hasAccess, workspaceEntitlements } from '../lib/entitlements';
import { trialNotice } from '../lib/trial-notice';
import { deleteFixtureUsers } from './fixture-cleanup';

const now = new Date();
const day = 86400000;
type State = 'trial-running' | 'trial-ends-today' | 'trial-expired' | 'active' | 'cancel-at-period-end' | 'period-ended' | 'payment-failed';
const cases: Array<{ name: State; status: string; trialEnd: Date | null; periodEnd: Date | null; pastDueSince?: Date | null; expectedAccess: boolean; expectedNotice: 'ending' | 'expired' | null }> = [
  { name: 'trial-running', status: 'trialing', trialEnd: new Date(+now + day), periodEnd: null, expectedAccess: true, expectedNotice: 'ending' },
  { name: 'trial-ends-today', status: 'trialing', trialEnd: now, periodEnd: null, expectedAccess: false, expectedNotice: 'expired' },
  { name: 'trial-expired', status: 'canceled', trialEnd: new Date(+now - day), periodEnd: null, expectedAccess: false, expectedNotice: 'expired' },
  { name: 'active', status: 'active', trialEnd: null, periodEnd: new Date(+now + 30 * day), expectedAccess: true, expectedNotice: null },
  { name: 'cancel-at-period-end', status: 'active', trialEnd: null, periodEnd: new Date(+now + day), expectedAccess: true, expectedNotice: null },
  { name: 'period-ended', status: 'active', trialEnd: null, periodEnd: new Date(+now - 4 * day), expectedAccess: false, expectedNotice: null },
  { name: 'payment-failed', status: 'past_due', trialEnd: null, periodEnd: new Date(+now + day), pastDueSince: new Date(+now - 7 * day), expectedAccess: false, expectedNotice: null },
];

async function main() {
  assert.match(readFileSync('app/app/billing/page.tsx', 'utf8'), /Renewal reconciliation may take up to three days; scheduled posts pause after that/);
  const db = getDb();
  const userId = crypto.randomUUID();
  let providerCalls = 0;
  registerPublisher({
    provider: 'mastodon', maxMediaBytes: 16_000_000, maxTextLength: 500, credentialFields: [],
    async validate() { return { externalId: 'trial-fixture', displayName: 'Trial fixture' }; },
    async publish(_credentials, input) { providerCalls++; return { remoteId: input.idempotencyKey, url: 'https://fixture.invalid/post' }; },
  });
  try {
    await db.insert(users).values({ id: userId, name: 'Trial-end fixture' });
    const workspace = await ensureWorkspace(userId);
    const [brand] = await db.insert(brands).values({ workspaceId: workspace.id, name: 'Trial brand', slug: 'trial-brand' }).returning();
    const [channel] = await db.insert(channels).values({ brandId: brand.id, provider: 'mastodon', displayName: 'Synthetic channel', externalId: 'synthetic', credentialsEnc: encryptCredentials({ token: 'never-sent' }) }).returning();
    await db.insert(subscriptions).values({ workspaceId: workspace.id, plan: 'agency', status: 'trialing', trialEnd: new Date(+now + day), stripeSubscriptionId: 'sub_trial_fixture' });
    await db.insert(billingState).values({ workspaceId: workspace.id });
    const initialBrands = (await db.select({ id: brands.id }).from(brands).where(eq(brands.workspaceId, workspace.id))).length;
    const results: string[] = [];
    for (const item of cases) {
      await db.update(subscriptions).set({ status: item.status, trialEnd: item.trialEnd, currentPeriodEnd: item.periodEnd, cancelAtPeriodEnd: item.name === 'cancel-at-period-end' }).where(eq(subscriptions.workspaceId, workspace.id));
      await db.update(billingState).set({ pastDueSince: item.pastDueSince ?? null }).where(eq(billingState.workspaceId, workspace.id));
      const [post] = await db.insert(posts).values({ brandId: brand.id, authorUserId: userId, body: `Scheduled ${item.name}`, status: 'scheduled', scheduledAt: new Date(+now - 1000) }).returning();
      const [target] = await db.insert(postTargets).values({ postId: post.id, channelId: channel.id, nextAttemptAt: new Date(+now - 1000) }).returning();
      const access = hasAccess({ stripeSubscriptionId: 'fixture', status: item.status, trialEnd: item.trialEnd, currentPeriodEnd: item.periodEnd, pastDueSince: item.pastDueSince }, now);
      assert.equal(access, item.expectedAccess, item.name);
      const notice = item.trialEnd ? trialNotice({ status: item.status, trialEnd: item.trialEnd.toISOString(), currentPeriodEnd: item.periodEnd?.toISOString() ?? null }, +now) : null;
      assert.equal(notice, item.expectedNotice, `${item.name} notice`);
      const ent = await workspaceEntitlements(workspace.id);
      assert.equal(ent.publish, item.expectedAccess, `${item.name} publish entitlement`);
      assert.equal(ent.limit, item.expectedAccess ? 15 : 3, `${item.name} brand limit`);
      assert.equal(ent.seats, item.expectedAccess ? 5 : 1, `${item.name} seats`);
      assert.equal(ent.approvalLinks, item.expectedAccess, `${item.name} approval links`);
      assert.equal(ent.api, item.expectedAccess, `${item.name} API entitlement`);
      const beforeCalls = providerCalls;
      await tick();
      const [after] = await db.select().from(postTargets).where(eq(postTargets.id, target.id));
      const [postAfter] = await db.select().from(posts).where(eq(posts.id, post.id));
      if (item.expectedAccess) { assert.equal(after.status, 'published', item.name); assert(providerCalls > beforeCalls, item.name); }
      else { assert.equal(after.status, 'held', item.name); assert.equal(providerCalls, beforeCalls, item.name); }
      assert.equal(postAfter.body, `Scheduled ${item.name}`);
      results.push(`${item.name}: access=${access} postTarget=${after.status} notice=${notice ?? 'none'} limits=${ent.limit}/${ent.seats}/${ent.api ? 'api' : 'no-api'}`);
    }
    const [resumePost] = await db.insert(posts).values({ brandId: brand.id, authorUserId: userId, body: 'Resume after payment', status: 'scheduled', scheduledAt: new Date(+now - 1000) }).returning();
    const [resumeTarget] = await db.insert(postTargets).values({ postId: resumePost.id, channelId: channel.id, nextAttemptAt: new Date(+now - 1000) }).returning();
    await db.update(subscriptions).set({ status: 'canceled', trialEnd: new Date(+now - day), currentPeriodEnd: null }).where(eq(subscriptions.workspaceId, workspace.id));
    await tick();
    assert.equal((await db.select().from(postTargets).where(eq(postTargets.id, resumeTarget.id)))[0].status, 'held');
    await db.update(subscriptions).set({ status: 'active', currentPeriodEnd: new Date(+now + day), trialEnd: null }).where(eq(subscriptions.workspaceId, workspace.id));
    await tick();
    assert.equal((await db.select().from(postTargets).where(eq(postTargets.id, resumeTarget.id)))[0].status, 'published');
    assert.equal((await db.select().from(posts).where(eq(posts.id, resumePost.id)))[0].body, 'Resume after payment');
    assert.equal((await db.select({ id: brands.id }).from(brands).where(eq(brands.workspaceId, workspace.id))).length, initialBrands);
    assert(providerCalls >= cases.filter(c => c.expectedAccess).length + 1);
    console.log(`PASS trial-end matrix: ${results.join('; ')}; resume=published; data=retained; providerCalls=${providerCalls}; no Stripe/mail calls`);
  } finally {
    await deleteFixtureUsers(db).where(eq(users.id, userId));
  }
}
main().catch(error => { console.error(error); process.exit(1); });
