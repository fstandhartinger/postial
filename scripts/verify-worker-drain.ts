import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawn, type ChildProcess } from 'node:child_process';
import { eq, sql } from 'drizzle-orm';
import { getDb } from '../db';
import { users, subscriptions, brands, channels, posts, postTargets, postEvents } from '../db/schema';
import { ensureWorkspace } from '../lib/workspaces';
import { encryptCredentials } from '../lib/crypto';
import { deleteFixtureUsers } from './fixture-cleanup';

const db = getDb(), root = mkdtempSync(`${tmpdir()}/postial-drain-`);
mkdirSync(root, { recursive: true });
const userId = crypto.randomUUID();
const children: ChildProcess[] = [];
let brandId: string, channelId: string;
async function fixture() {
  if (!brandId) {
    await db.insert(users).values({ id: userId, name: 'Worker drain fixture' });
    const workspace = await ensureWorkspace(userId);
    await db.insert(subscriptions).values({ workspaceId: workspace.id, status: 'active', currentPeriodEnd: new Date(Date.now() + 86400000), stripeSubscriptionId: `fixture-${userId}` });
    const [brand] = await db.insert(brands).values({ workspaceId: workspace.id, name: 'Drain', slug: 'drain' }).returning(); brandId = brand.id;
    const [channel] = await db.insert(channels).values({ brandId, provider: 'mastodon', displayName: 'Fixture', externalId: 'fixture', credentialsEnc: encryptCredentials({ token: 'fixture' }) }).returning(); channelId = channel.id;
  }
  const [post] = await db.insert(posts).values({ brandId, authorUserId: userId, body: 'Drain fixture', status: 'scheduled', scheduledAt: new Date(Date.now() - 1000) }).returning();
  const [target] = await db.insert(postTargets).values({ postId: post.id, channelId, nextAttemptAt: new Date(Date.now() - 1000) }).returning();
  return target;
}
function child(mode: string, targetId: string, extra: Record<string, string> = {}) {
  const p = spawn(process.execPath, ['--import', 'tsx', 'scripts/worker-drain-child.ts', mode, targetId, root], { env: { ...process.env, ...extra }, stdio: 'inherit' });
  children.push(p); return p;
}
async function waitFor(path: string, ms = 5000) { const until = Date.now() + ms; while (!existsSync(path)) { if (Date.now() > until) throw new Error(`timeout waiting for ${path}`); await new Promise(r => setTimeout(r, 20)); } }
async function exited(p: ChildProcess) { if (p.exitCode !== null) return; await new Promise<void>(resolve => p.once('exit', () => resolve())); }
function calls(id: string) { return readFileSync(`${root}/calls-${id}`, 'utf8').trim().split('\n').filter(Boolean).length; }
async function main() { try {
  // 1: a hard process stop after claim leaves a durable publishing lease.
  const killed = await fixture(); const a = child('wait', killed.id); await waitFor(`${root}/entered-${killed.id}`); a.kill('SIGKILL'); await exited(a);
  let row = (await db.select().from(postTargets).where(eq(postTargets.id, killed.id)))[0];
  assert.equal(row.status, 'publishing'); assert.equal(row.attempts, 1); assert.equal(calls(killed.id), 1);
  await db.update(postTargets).set({ attemptStartedAt: new Date(Date.now() - 660000) }).where(eq(postTargets.id, killed.id));
  const restart = child('success', killed.id); await exited(restart);
  row = (await db.select().from(postTargets).where(eq(postTargets.id, killed.id)))[0];
  assert.equal(row.status, 'needs_review'); assert.equal(calls(killed.id), 1);
  console.log('PASS 1: SIGKILL after claim preserves publishing lease; restart does not auto-republish');

  // 2/3: an expired lease is fenced while the original network call is still alive.
  const expired = await fixture(); const original = child('wait', expired.id); await waitFor(`${root}/entered-${expired.id}`);
  await db.update(postTargets).set({ attemptStartedAt: new Date(Date.now() - 660000) }).where(eq(postTargets.id, expired.id));
  const recovery = child('success', expired.id); await exited(recovery);
  row = (await db.select().from(postTargets).where(eq(postTargets.id, expired.id)))[0];
  assert.equal(row.status, 'needs_review'); assert.equal(calls(expired.id), 1);
  assert.equal((await db.select().from(postEvents).where(eq(postEvents.targetId, expired.id))).filter(e => e.type === 'recovered').length, 1);
  assert.equal(original.kill('SIGTERM'), true); await exited(original);
  console.log('PASS 2/3: expired live lease is fenced and provider call count remains 1');

  // 4: the real interval worker drains an active publish before SIGTERM exits.
  const graceful = await fixture(); const started = Date.now(); const worker = child('worker', graceful.id, { WORKER_ENABLED: 'true', WORKER_INTERVAL_MS: '25' }); await waitFor(`${root}/entered-${graceful.id}`);
  worker.kill('SIGTERM'); await new Promise(r => setTimeout(r, 100)); assert.equal(worker.exitCode, null);
  writeFileSync(`${root}/release-${graceful.id}`, 'release\n'); await exited(worker);
  row = (await db.select().from(postTargets).where(eq(postTargets.id, graceful.id)))[0];
  assert.equal(row.status, 'published'); assert(Date.now() - started < 5000);
  console.log('PASS 4: SIGTERM waits for the active tick and exits after publish');
} finally {
  for (const p of children) if (p.exitCode === null) p.kill('SIGKILL');
  await deleteFixtureUsers(db).where(eq(users.id, userId));
  await db.$client.end(); rmSync(root, { recursive: true, force: true });
} }
main().catch(error => { console.error(error); process.exitCode = 1; });
