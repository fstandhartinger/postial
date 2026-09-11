import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:net';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { getDb } from '../db';
import { brands, channelAlertEmails, channels, notifications, posts, users, workspaces } from '../db/schema';
import { notifyWorkspace } from '../lib/notifications';
import { alertMailContent, clearChannelAlertLocks, recordChannelAlert, sendPendingChannelAlertMail } from '../lib/alert-mail';

process.env.NEXT_PUBLIC_APP_URL = 'https://postial.co';
process.env.AUTH_URL = 'https://postial.co';
process.env.EMAIL_FROM = 'Postial <verify@example.invalid>';

const db = getDb();
const userId = crypto.randomUUID();
const workspaceId = crypto.randomUUID();
const brandId = crypto.randomUUID();
const channelA = crypto.randomUUID();
const channelB = crypto.randomUUID();
const post1 = crypto.randomUUID();
const post2 = crypto.randomUUID();
const post3 = crypto.randomUUID();
const ownerEmail = `alert-mail-owner-${userId}@example.invalid`;
const messages: string[] = [];

function smtpFixture(): Promise<{ server: Server; url: string }> {
  const server = createServer(socket => {
    let data = '';
    let inMessage = false;
    socket.write('220 fixture.local\r\n');
    socket.on('data', chunk => {
      data += chunk.toString();
      while (true) {
        if (inMessage) {
          const end = data.indexOf('\r\n.\r\n');
          if (end < 0) break;
          messages.push(data.slice(0, end));
          data = data.slice(end + 5);
          inMessage = false;
          socket.write('250 queued\r\n');
          continue;
        }
        const end = data.indexOf('\r\n');
        if (end < 0) break;
        const line = data.slice(0, end);
        data = data.slice(end + 2);
        if (/^EHLO|^HELO/i.test(line)) socket.write('250-fixture.local\r\n250 OK\r\n');
        else if (/^MAIL FROM|^RCPT TO/i.test(line)) socket.write('250 OK\r\n');
        else if (/^DATA/i.test(line)) { inMessage = true; socket.write('354 end with dot\r\n'); }
        else if (/^QUIT/i.test(line)) socket.write('221 bye\r\n');
      }
    });
  });
  server.listen(0, '127.0.0.1');
  return once(server, 'listening').then(() => ({ server, url: `smtp://127.0.0.1:${(server.address() as { port: number }).port}` }));
}

/** Quoted-printable decoding so content assertions hold regardless of line folding. */
function decoded(raw: string): string {
  return raw.replace(/=\r\n/g, '').replace(/=([0-9A-Fa-f]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

async function alertRow(channelId: string, kind: string) {
  const [row] = await db.select().from(channelAlertEmails)
    .where(and(eq(channelAlertEmails.channelId, channelId), eq(channelAlertEmails.kind, kind))).limit(1);
  return row;
}
async function incident(channelId: string, kind: 'token_expired' | 'failed', postId: string | null) {
  // The publish/health paths record inside their transaction and send after it commits.
  await db.transaction(async tx => { await recordChannelAlert(tx, workspaceId, channelId, kind, postId); });
  await sendPendingChannelAlertMail(workspaceId, channelId, kind);
}
async function ageWindow(channelId: string, kind: string) {
  await db.update(channelAlertEmails)
    .set({ attemptedAt: new Date(Date.now() - 25 * 3600_000), sentAt: new Date(Date.now() - 25 * 3600_000) })
    .where(and(eq(channelAlertEmails.channelId, channelId), eq(channelAlertEmails.kind, kind)));
}

/** (c) File and journal for migration 0022 exist, table is usable, journal timestamp is after 0021. */
function verifyMigration() {
  const journal = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8')) as { entries: { idx: number; tag: string; when: number }[] };
  const entry = journal.entries.find(e => e.tag === '0022_channel-alert-emails');
  const previous = journal.entries.filter(e => e.tag.startsWith('0021_')).at(-1);
  assert(entry, 'journal entry for 0022_channel-alert-emails exists');
  assert(previous, 'journal entry for 0021 exists');
  assert(entry.when > previous.when, 'journal timestamp of 0022 is after 0021');
  assert.equal(entry.idx, previous.idx + 1, '0022 follows 0021 in the journal');
  const migration = readFileSync('drizzle/0022_channel-alert-emails.sql', 'utf8');
  assert(migration.includes('CREATE TABLE "channel_alert_emails"'), 'migration 0022 creates the dedupe table');
  console.log('PASS alert mail: migration 0022 registered after 0021 with later journal timestamp');
}
/** (a) Content mirrors the trial reminder: factual event, meaning, exactly one link. */
function verifyContent() {
  const expired = alertMailContent('token_expired', 'Fixture X-One', 'x', [post1]);
  assert.equal(expired.subject, 'Channel access expired: Fixture X-One');
  assert(expired.text.includes('https://postial.co/app/channels'), 'token mail links to channels');
  assert.equal((expired.text.match(/https:\/\//g) || []).length, 1, 'token mail text has exactly one link');
  assert.equal((expired.html.match(/href=/g) || []).length, 1, 'token mail html has exactly one link');
  assert(expired.text.includes('has expired'), 'token mail states what happened');
  assert(expired.text.includes('reconnected'), 'token mail states the meaning');
  assert(expired.text.includes('1 post could not be published'), 'token mail counts the affected post');

  const failedOne = alertMailContent('failed', 'Fixture X-Two', 'x', [post1]);
  assert(failedOne.text.includes(`https://postial.co/app/posts/${post1}`), 'single failed post links to the post');
  assert.equal((failedOne.text.match(/https:\/\//g) || []).length, 1, 'failed mail text has exactly one link');
  assert.equal((failedOne.html.match(/href=/g) || []).length, 1, 'failed mail html has exactly one link');

  const failedTwo = alertMailContent('failed', 'Fixture X-One', 'x', [post1, post2]);
  assert(failedTwo.text.includes('2 posts'), 'aggregation states the count');
  assert(failedTwo.text.includes('https://postial.co/app/channels'), 'aggregated failure links to channels');
  assert(failedTwo.text.includes('history'), 'failed mail states the meaning');
  assert.equal((failedTwo.html.match(/href=/g) || []).length, 1, 'aggregated mail html has exactly one link');

  const inlined = alertMailContent('token_expired', '<script>', 'x', []);
  assert(!inlined.html.includes('<script>'), 'channel name is escaped in html');
  console.log('PASS alert mail: factual content, meaning, exactly one link, aggregated count, escaped html');
}

/** (b) needs_review stays in-app only and never reaches mail. */
async function verifyNeedsReviewSilent() {
  const before = messages.length;
  await db.transaction(async tx => { await notifyWorkspace(tx, workspaceId, 'needs_review', post1); });
  assert.equal(messages.length, before, 'needs_review sends no mail');
  const [row] = await db.select().from(channelAlertEmails).where(eq(channelAlertEmails.kind, 'needs_review'));
  assert(!row, 'needs_review never writes a mail incident row');
  const [notice] = await db.select().from(notifications)
    .where(and(eq(notifications.workspaceId, workspaceId), eq(notifications.type, 'needs_review')));
  assert(notice, 'needs_review still lands as an in-app notification');
  const publishing = readFileSync('lib/publishing/index.ts', 'utf8');
  assert(!/recordChannelAlert\([\s\S]{0,140}needs_review/.test(publishing), 'publish path never records needs_review for mail');
  console.log('PASS alert mail: needs_review notifies in-app only, never by mail');
}

/** (e) Uncommitted incidents never mail; send failures are recorded and swallowed. */
async function verifyTransactionSafety(smtpUrl: string) {
  const before = messages.length;
  await assert.rejects(db.transaction(async tx => {
    await recordChannelAlert(tx, workspaceId, channelB, 'token_expired', post3);
    throw new Error('rollback fixture');
  }), /rollback fixture/, 'fixture rolls back');
  await sendPendingChannelAlertMail(workspaceId, channelB, 'token_expired');
  assert.equal(messages.length, before, 'nothing mails for a rolled-back transaction');
  assert(!(await alertRow(channelB, 'token_expired')), 'rolled back incident left no row');

  const previousSmtp = process.env.SMTP_URL;
  process.env.SMTP_URL = 'smtp://127.0.0.1:1';
  await incident(channelB, 'token_expired', post3);
  assert.equal(messages.length, before, 'failed SMTP swallowed without throwing');
  const broken = await alertRow(channelB, 'token_expired');
  assert(broken?.error, 'send failure is captured on the row');
  assert.equal(broken.pending, true, 'failed batch stays pending for a later incident');
  assert.equal(broken.sentAt, null, 'failed batch is not marked sent');
  process.env.SMTP_URL = previousSmtp ?? smtpUrl;
  await ageWindow(channelB, 'token_expired');
  await incident(channelB, 'token_expired', post3);
  assert.equal(messages.length, before + 1, 'a later incident retries after a failed attempt');
  const recovered = await alertRow(channelB, 'token_expired');
  assert.equal(recovered?.error, null, 'successful retry clears the recorded error');
  assert(recovered?.sentAt, 'successful retry is marked sent');
  console.log('PASS alert mail: sends only after commit, failures captured and swallowed, later incident retries');
}

/** (d) A channel back in connected state may alert again immediately. */
async function verifyResetOnActive() {
  const locked = await alertRow(channelB, 'failed');
  assert(locked?.sentAt, 'channel has an active 24h lock before reset');
  const before = messages.length;
  await incident(channelB, 'failed', post3);
  assert.equal(messages.length, before, 'sanity: repeat inside the window is suppressed');
  await db.transaction(async tx => { await clearChannelAlertLocks(tx, channelB); });
  await incident(channelB, 'failed', post3);
  assert.equal(messages.length, before + 1, 'reset on reconnect lets the next incident mail immediately');
  for (const [file, needle] of [
    ['lib/publishing/health.ts', 'clearChannelAlertLocks'],
    ['lib/publishers/oauth.ts', 'clearChannelAlertLocks'],
  ]) {
    const source = readFileSync(file, 'utf8');
    assert(source.includes(needle), `${file} resets the lock when the channel becomes active again`);
  }
  const publishing = readFileSync('lib/publishing/index.ts', 'utf8');
  assert(publishing.indexOf('const finalStatus = await db.transaction') < publishing.indexOf('for (const alert of alertMails)'),
    'publish path sends incident mail only after the status transaction');
  const health = readFileSync('lib/publishing/health.ts', 'utf8');
  assert(health.indexOf('await getDb().transaction(async tx => {') < health.indexOf('sendPendingChannelAlertMail('),
    'health path sends incident mail only after the update transaction');
  console.log('PASS alert mail: reconnect reset works and recovery/publish paths send only after commit');
}

async function main() {
  const smtp = await smtpFixture();
  process.env.SMTP_URL = smtp.url;
  try {
    await db.insert(users).values({ id: userId, email: ownerEmail, name: 'Alert mail fixture' });
    await db.insert(workspaces).values({ id: workspaceId, ownerUserId: userId, name: 'Alert mail fixture', slug: `alert-mail-${workspaceId}` });
    await db.insert(brands).values({ id: brandId, workspaceId, name: 'Alert mail brand', slug: 'alert-mail-brand' });
    await db.insert(channels).values([
      { id: channelA, brandId, provider: 'x', displayName: 'Fixture X-One', externalId: 'fixture-one', credentialsEnc: 'fixture-enc' },
      { id: channelB, brandId, provider: 'linkedin', displayName: 'Fixture LinkedIn', externalId: 'fixture-two', credentialsEnc: 'fixture-enc' },
    ]);
    await db.insert(posts).values([
      { id: post1, brandId, body: 'fixture post one', status: 'scheduled' },
      { id: post2, brandId, body: 'fixture post two', status: 'scheduled' },
      { id: post3, brandId, body: 'fixture post three', status: 'scheduled' },
    ]);

    verifyMigration();
    verifyContent();

    // (a) token_expired mails the workspace owner through the SMTP transport, like the trial reminder.
    await incident(channelA, 'token_expired', post1);
    assert.equal(messages.length, 1, 'first token_expired incident mails once');
    const expiredMail = decoded(messages.at(-1)!);
    assert(expiredMail.includes(`To: ${ownerEmail}`), 'mail goes to the workspace owner');
    assert(expiredMail.includes('Subject: Channel access expired: Fixture X-One'), 'token subject');
    assert(expiredMail.includes('verify@example.invalid'), 'sender follows EMAIL_FROM like the trial reminder');
    assert(/From:.*Postial/i.test(expiredMail), 'sender is Postial');
    assert(expiredMail.includes('https://postial.co/app/channels'), 'token mail links to channels');
    const expiredRow = await alertRow(channelA, 'token_expired');
    assert(expiredRow?.sentAt, 'sent attempt is persisted');
    assert.equal(expiredRow?.pending, false, 'nothing left pending');

    await verifyNeedsReviewSilent();

    // (a) failed aggregates several affected posts into one mail with count.
    await db.transaction(async tx => {
      await recordChannelAlert(tx, workspaceId, channelA, 'failed', post1);
      await recordChannelAlert(tx, workspaceId, channelA, 'failed', post2);
    });
    await sendPendingChannelAlertMail(workspaceId, channelA, 'failed');
    assert.equal(messages.length, 2, 'a burst of failures mails once');
    const failedMail = decoded(messages.at(-1)!);
    assert(failedMail.includes('Subject: Publishing failed on Fixture X-One'), 'failed subject');
    assert(failedMail.includes('2 posts'), 'aggregated mail states the count');

    // (c) another channel has its own budget and a single failed post links to it.
    await incident(channelB, 'failed', post1);
    assert.equal(messages.length, 3, 'second channel has its own mail budget');
    const singleMail = decoded(messages.at(-1)!);
    assert(singleMail.includes(`https://postial.co/app/posts/${post1}`), 'single failure links to the affected post');

    // (c) the 24h window suppresses repeats per workspace, kind and channel, durable in the database.
    const lockedBefore = await alertRow(channelA, 'failed');
    await incident(channelA, 'failed', post2);
    await incident(channelA, 'token_expired', post1);
    assert.equal(messages.length, 3, 'repeats inside the 24h window stay silent');
    const lockedAfter = await alertRow(channelA, 'failed');
    assert.equal(lockedAfter?.sentAt?.getTime(), lockedBefore?.sentAt?.getTime(), 'stored window untouched by suppressed repeat');
    assert.deepEqual(lockedAfter?.postIds, lockedBefore?.postIds, 'suppressed repeat does not rewrite the mailed batch');
    await ageWindow(channelA, 'failed');
    await incident(channelA, 'failed', post2);
    assert.equal(messages.length, 4, 'after 24h the next incident mails again');
    const refreshed = await alertRow(channelA, 'failed');
    assert.notEqual(refreshed?.sentAt?.getTime(), lockedBefore?.sentAt?.getTime(), 'new window persisted');
    console.log('PASS alert mail: owner mail for token_expired and failed, one per workspace/kind/channel per 24h');

    await verifyResetOnActive();
    await verifyTransactionSafety(smtp.url);

    console.log('PASS alert mail verification complete (a-e)');
  } finally {
    await new Promise<void>((resolvePromise, rejectPromise) => smtp.server.close(error => error ? rejectPromise(error) : resolvePromise()));
    await db.delete(notifications).where(eq(notifications.workspaceId, workspaceId));
    await db.delete(channelAlertEmails).where(inArray(channelAlertEmails.channelId, [channelA, channelB]));
    await db.execute(sql`delete from post_targets where post_id in (${post1}, ${post2}, ${post3})`);
    await db.delete(posts).where(inArray(posts.id, [post1, post2, post3]));
    await db.delete(channels).where(inArray(channels.id, [channelA, channelB]));
    await db.delete(brands).where(eq(brands.id, brandId));
    await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await db.delete(users).where(eq(users.id, userId));
    await db.$client.end();
  }
}

main().catch(error => { console.error('Alert mail verification failed:', error instanceof Error ? error.message : 'unknown'); process.exitCode = 1; });
