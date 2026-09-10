import assert from 'node:assert/strict';
import { redactErrorValue, recordError, recentErrorCount } from '../lib/error-visibility';
import { errorEvents } from '../db/schema';
import { getDb } from '../db';
import { sql } from 'drizzle-orm';

async function verify() {
  const db = getDb();
  const marker = `error-visibility-${Date.now()}`;
  assert(!redactErrorValue('mail alice@example.com token=sm_live_abc content=private post').includes('alice@example.com'));
  assert(!redactErrorValue('mail alice@example.com token=sm_live_abc content=private post').includes('sm_live_abc'));
  assert(!redactErrorValue('mail alice@example.com token=sm_live_abc content=private post').includes('private post'));
  const personal = 'Alice Example lives at alice@example.com and wrote: Please publish this private post about the garden.';
  await recordError(new Error(`route ${personal}`), {route:`/api/${marker}`, status:500, authenticated:true});
  await recordError(new Error(`worker ${personal}`), {route:`worker:${marker}`});
  const rows = await db.select().from(errorEvents).where(sql`${errorEvents.route} like ${`%${marker}%`}`);
  assert.equal(rows.length, 2); assert(rows.every(row => !JSON.stringify(row).includes('alice@example.com') && !JSON.stringify(row).includes('Alice Example') && !JSON.stringify(row).includes('private post') && row.message === '[message omitted]'));
  const original = process.env.ERROR_VISIBILITY_TEST_CAP;
  process.env.ERROR_VISIBILITY_TEST_CAP = '2';
  const capStart = new Date(Date.now() + 3600000);
  for (let i=0;i<3;i++) await recordError(new Error(`cap-${i}`), {route:`/api/${marker}`, now:new Date(capStart.getTime()+i)});
  if (original === undefined) delete process.env.ERROR_VISIBILITY_TEST_CAP; else process.env.ERROR_VISIBILITY_TEST_CAP = original;
  const capped = await db.select().from(errorEvents).where(sql`${errorEvents.route} like ${`%${marker}%`}`);
  assert.equal(capped.length, 4);
  await db.delete(errorEvents).where(sql`${errorEvents.route} like ${`%${marker}%`}`);
  console.log('error visibility: API+worker, redaction, best-effort path, cap PASS');
}
verify().catch(error => { console.error(error instanceof Error ? error.message : 'verification failed'); process.exit(1); });
