// Shared origin takes precedence; historical per-script variables remain supported.
if (process.env.VERIFY_BASE_URL) process.env.WAITLIST_BASE_URL = process.env.VERIFY_BASE_URL;
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { assertVerificationDatabase } from './isolated-db.mjs';
async function main() {
const base = process.env.WAITLIST_BASE_URL ?? 'http://127.0.0.1:3987';
const url = new URL(base);
if (!['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error('Local test server required');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required for fixture cleanup');
assertVerificationDatabase();
const db = postgres(process.env.DATABASE_URL, { max: 1 });
const run = randomUUID();
const ip = `2001:db8:${Math.floor(Math.random()*65535).toString(16)}::1`;
async function send(email: string, network = 'linkedin', forwarded = ip) {
  return fetch(`${base}/api/waitlist`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-for': forwarded }, body: JSON.stringify({ email, network, source: 'pricing' }) });
}
try {
  assert.equal((await send(`${run}-0@example.com`)).status, 202);
  assert.equal((await send(` ${run.toUpperCase()}-0@EXAMPLE.COM `)).status, 202);
  assert.equal((await send('not-an-email')).status, 422);
  assert.equal((await send(`${run}-invalid@example.com`, 'bluesky')).status, 422);
  assert.equal((await send(`${run}-invalid@example.com`, 'unknown')).status, 422);
  for (let i = 1; i < 10; i++) assert.equal((await send(`${run}-${i}@example.com`)).status, 202);
  const limited = await send(`${run}-10@example.com`);
  assert.equal(limited.status, 429); assert.equal(limited.headers.get('retry-after'), '3600');
  assert.equal((await send(`${run}-11@example.com`, 'threads', `192.0.2.22, ${ip}`)).status, 429, 'Client-supplied leading IP cannot bypass limit');
  assert.equal((await send(`${run}-0@example.com`)).status, 202, 'Duplicate remains indistinguishable at limit');
  const rows = await db`select * from network_waitlist where email like ${run+'-%'}`;
  assert.equal(rows.length, 10);
  assert.ok(rows.every(r => r.source === 'pricing' && /^[a-f0-9]{64}$/.test(r.ip_hash) && !r.ip_hash.includes(ip)));
  console.log('PASS: uniform 202 success, invalid 422, eleventh registration 429, proxy spoof resistance, persisted rows');
} finally { await db`delete from network_waitlist where email like ${run+'-%'}`; await db.end(); }

}
main().catch(() => { console.error("Waitlist verification failed"); process.exitCode = 1; });
