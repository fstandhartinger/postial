import './test-runtime';
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { eq, inArray } from 'drizzle-orm';
import { getDb } from '../db';
import { users, brands, channels, posts, subscriptions } from '../db/schema';
import { ensureWorkspace } from '../lib/workspaces';
import { encryptCredentials } from '../lib/crypto';
import { localDateTime, inZone } from '../lib/timezone';
import { postInput } from '../lib/api/posts';
import { savePost, reschedulePost } from '../lib/api/post-service';
import { deleteFixtureUsers } from './fixture-cleanup';

// Expected UTC instants below are hand-computed (Europe/Berlin switches at 01:00 UTC,
// CET +01:00 <-> CEST +02:00; Asia/Tokyo is +09:00 and Asia/Kolkata +05:30 year-round)
// and never derived from the function under test.

const DST_ERROR = /skipped or occurs twice/;

test('Europe/Berlin 2026-03-29: the spring-forward hour 02:xx does not exist', () => {
  assert.throws(() => localDateTime('2026-03-29T02:30', 'Europe/Berlin'), DST_ERROR, 'localDateTime must reject a wall clock inside the DST gap');
  for (const [wall, utc] of [
    ['2026-03-29T01:30', '2026-03-29T00:30:00.000Z'],
    ['2026-03-29T03:30', '2026-03-29T01:30:00.000Z'],
  ] as const) {
    const resolved = localDateTime(wall, 'Europe/Berlin');
    assert.equal(resolved.toISOString(), utc);
    assert.equal(inZone(resolved, 'Europe/Berlin'), wall, 'resolved instant must render back as the requested wall clock');
  }
});

test('Europe/Berlin 2026-10-25: the fall-back hour 02:xx occurs twice', () => {
  assert.throws(() => localDateTime('2026-10-25T02:30', 'Europe/Berlin'), DST_ERROR, 'localDateTime must reject a wall clock inside the DST fold');
  for (const [wall, utc] of [
    // 01:30 is still CEST: the clocks go back at 03:00 local, so this is 23:30Z the day before.
    ['2026-10-25T01:30', '2026-10-24T23:30:00.000Z'],
    ['2026-10-25T03:30', '2026-10-25T02:30:00.000Z'],
  ] as const) {
    const resolved = localDateTime(wall, 'Europe/Berlin');
    assert.equal(resolved.toISOString(), utc);
    assert.equal(inZone(resolved, 'Europe/Berlin'), wall, 'resolved instant must render back as the requested wall clock');
  }
});

test('zones without DST resolve exactly (Asia/Tokyo +9, Asia/Kolkata +5:30)', () => {
  assert.equal(localDateTime('2027-01-15T21:30', 'Asia/Tokyo').toISOString(), '2027-01-15T12:30:00.000Z');
  assert.equal(localDateTime('2027-07-15T21:30', 'Asia/Tokyo').toISOString(), '2027-07-15T12:30:00.000Z');
  assert.equal(localDateTime('2027-01-15T17:30', 'Asia/Kolkata').toISOString(), '2027-01-15T12:00:00.000Z');
  assert.equal(localDateTime('2027-07-15T17:30', 'Asia/Kolkata').toISOString(), '2027-07-15T12:00:00.000Z');
});

test('the same wall clock in two brand zones is two different instants', () => {
  const berlin = localDateTime('2027-06-15T12:30', 'Europe/Berlin');
  const newYork = localDateTime('2027-06-15T12:30', 'America/New_York');
  assert.equal(berlin.toISOString(), '2027-06-15T10:30:00.000Z');
  assert.equal(newYork.toISOString(), '2027-06-15T16:30:00.000Z');
  assert.notEqual(berlin.toISOString(), newYork.toISOString());
});

test('scheduled_at interface requires an explicit zone (z.string().datetime({offset:true}))', () => {
  const base = { brand_id: crypto.randomUUID(), body: 'x' };
  assert.equal(postInput.safeParse({ ...base, scheduled_at: '2027-06-15T12:30:00' }).success, false, 'datetime without any zone must be rejected');
  for (const zoned of ['2027-06-15T12:30:00Z', '2027-06-15T12:30:00+02:00']) {
    const parsed = postInput.safeParse({ ...base, scheduled_at: zoned });
    assert.equal(parsed.success, true, `${zoned} must be accepted`);
    if (parsed.success) assert.equal(parsed.data.scheduled_at, zoned);
  }
});

const git = (args: string[]) => execFileSync('git', args, { cwd: process.cwd(), encoding: 'utf8' }).trim();

test('production timezone wiring is the code under test, not a copy', () => {
  const base = git(['merge-base', 'HEAD', 'main']);
  const grepBase = (flag: '-E' | '-F', pattern: string, file: string) => {
    try { return git(['grep', '-n', flag, pattern, base, '--', file]); } catch { return ''; }
  };
  assert.match(grepBase('-E', 'export function localDateTime', 'lib/timezone.ts'), /localDateTime/, 'localDateTime must live in lib/timezone.ts at the merge base');
  for (const [fn, expected] of [['savePost', /\bisoDate\s*=\s*false\b/], ['reschedulePost', /\bisoDate\s*=\s*true\b/]] as const) {
    const sources: string[] = [];
    try { sources.push(git(['show', `${base}:lib/api/post-service.ts`])); } catch { /* file introduced above the base */ }
    sources.push(readFileSync('lib/api/post-service.ts', 'utf8'));
    const params = sources.map((s) => s.match(new RegExp(`export async function ${fn}\\(([^)]*)\\)`))?.[1]).find(Boolean);
    assert(params, `signature of ${fn} not found`);
    assert.match(params, expected, `${fn} default changed; swap verification below is anchored to it`);
  }
  const zodLines = grepBase('-F', 'datetime({offset', 'lib/api/posts.ts').split('\n').filter((line) => /datetime\(\{offset:\s*true\}\)/.test(line));
  assert.ok(zodLines.length >= 2, 'both scheduled_at checks must exist in lib/api/posts.ts at the merge base');
});

const db = getDb();
const userId = crypto.randomUUID();
const ctx = { db, workspace: { id: '' }, userId };
const ny: { brand: typeof brands.$inferSelect; channel: typeof channels.$inferSelect } = {} as never;
let nyPostId = '';

before(async () => {
  assert.notEqual(process.env.NODE_ENV, 'production');
  await db.insert(users).values({ id: userId, name: 'Timezone guard fixture' });
  const workspace = await ensureWorkspace(userId);
  ctx.workspace = workspace;
  await db.insert(subscriptions).values({
    workspaceId: workspace.id, plan: 'agency', status: 'trialing',
    trialEnd: new Date(Date.now() + 2 * 86400000), stripeSubscriptionId: 'tz-' + userId,
  });
  const [brand] = await db.insert(brands).values({ workspaceId: workspace.id, name: 'TZ New York', slug: 'tz-ny', timezone: 'America/New_York' }).returning();
  const [channel] = await db.insert(channels).values({
    brandId: brand.id, provider: 'mastodon', displayName: 'TZ NY Mastodon',
    externalId: 'tz-ny-' + userId, credentialsEnc: encryptCredentials({ accessToken: 'synthetic-tz', instanceUrl: 'https://fixture.invalid' }),
  }).returning();
  Object.assign(ny, { brand, channel });
});

after(async () => {
  await deleteFixtureUsers(db).where(inArray(users.id, [userId]));
});

function scheduleForm(brandId: string, channelId: string, scheduledAt: string) {
  const form = new FormData();
  for (const [key, value] of Object.entries({ brandId, body: 'Timezone guard fixture', intent: 'publish', when: 'later', scheduledAt })) form.set(key, value);
  form.append('channelId', channelId);
  return savePost(ctx, form); // third parameter deliberately omitted: the default must treat the value as brand wall clock
}

test('savePost with omitted isoDate treats scheduledAt as brand wall clock', async () => {
  nyPostId = await scheduleForm(ny.brand.id, ny.channel.id, '2027-06-15T12:30');
  const post = (await db.select().from(posts).where(eq(posts.id, nyPostId)))[0];
  assert.equal(post.scheduledAt?.toISOString(), '2027-06-15T16:30:00.000Z');
  // Under isoDate = true this value would be accepted by new Date(); localDateTime must reject its seconds part.
  await assert.rejects(scheduleForm(ny.brand.id, ny.channel.id, '2027-06-15T12:30:00'), /valid date and time/, 'savePost default must not parse via new Date()');
});

test('two brands, same wall clock: the database stores two different instants', async () => {
  const [brand] = await db.insert(brands).values({ workspaceId: ctx.workspace.id, name: 'TZ Berlin', slug: 'tz-berlin', timezone: 'Europe/Berlin' }).returning();
  const [channel] = await db.insert(channels).values({
    brandId: brand.id, provider: 'mastodon', displayName: 'TZ Berlin Mastodon',
    externalId: 'tz-berlin-' + userId, credentialsEnc: encryptCredentials({ accessToken: 'synthetic-tz', instanceUrl: 'https://fixture.invalid' }),
  }).returning();
  const berlinPostId = await scheduleForm(brand.id, channel.id, '2027-06-15T12:30');
  const rows = await db.select().from(posts).where(inArray(posts.id, [nyPostId, berlinPostId]));
  const stored = Object.fromEntries(rows.map((row) => [row.id, row.scheduledAt?.toISOString()]));
  assert.equal(stored[nyPostId], '2027-06-15T16:30:00.000Z');
  assert.equal(stored[berlinPostId], '2027-06-15T10:30:00.000Z');
  assert.notEqual(stored[nyPostId], stored[berlinPostId]);
});

test('reschedulePost with omitted isoDate treats the value as an absolute instant', async () => {
  await reschedulePost(ctx, nyPostId, '2027-06-15T12:30:00+05:30'); // fourth parameter deliberately omitted: the default must parse the explicit offset
  const moved = (await db.select().from(posts).where(eq(posts.id, nyPostId)))[0];
  assert.equal(moved.scheduledAt?.toISOString(), '2027-06-15T07:00:00.000Z');
});

process.on('beforeExit', () => console.log('PASS timezone: DST gap/fold rejected in Europe/Berlin 2026, Tokyo/Kolkata/brand-zone wall clocks exact, scheduled_at requires explicit zone, savePost/reschedulePost defaults locked by behavior'));
