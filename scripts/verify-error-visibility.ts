import assert from 'node:assert/strict';
import { extractSourceLocation, redactErrorValue, recordError, recentErrorCount } from '../lib/error-visibility';
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
  function knownSourceFunction() { return new Error(`route ${personal}`); }
  const known = knownSourceFunction();
  const knownLocation = extractSourceLocation(known);
  assert.match(knownLocation, /scripts\/verify-error-visibility\.ts:\d+ \(knownSourceFunction\)/);
  await recordError(known, {route:`/api/${marker}`, status:500, authenticated:true});
  await recordError(new Error(`worker ${personal}`), {route:`worker:${marker}`});
  const rows = await db.select().from(errorEvents).where(sql`${errorEvents.route} like ${`%${marker}%`}`);
  assert.equal(rows.length, 2); assert(rows.every(row => !JSON.stringify(row).includes('alice@example.com') && !JSON.stringify(row).includes('Alice Example') && !JSON.stringify(row).includes('private post') && row.message === '[message omitted]'));
  assert.equal(rows[0]?.sourceLocation, knownLocation);
  assert.deepEqual(Object.keys(rows[0] ?? {}).sort(), ['authenticated', 'errorClass', 'fingerprint', 'id', 'message', 'occurredAt', 'route', 'sourceLocation', 'status'].sort());
  const rootCause = () => new Error('root cause');
  const middleCause = () => new Error('middle', {cause: rootCause()});
  const topCause = () => new Error('top', {cause: middleCause()});
  assert.match(extractSourceLocation(topCause()), /scripts\/verify-error-visibility\.ts:\d+ \(rootCause\)/);
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
