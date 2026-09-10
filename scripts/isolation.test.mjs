import test from 'node:test';
import assert from 'node:assert/strict';
import postgres from 'postgres';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { assertVerificationDatabase, createIsolatedDatabase } from './isolated-db.mjs';
const source = process.env.TEST_ADMIN_URL;
assert(source && new URL(source).pathname === '/postial_verify_admin', 'explicit TEST_ADMIN_URL required');
const admin = postgres(source, { max: 1 });
test.after(async () => { await admin.end(); });
async function clean() {
  const rows = await admin`select datname as name from pg_database where datname ~ '^postial_verify_[0-9]+_[a-f0-9]{6}$'
    union all select rolname as name from pg_roles where rolname ~ '^postial_verify_[0-9]+_[a-f0-9]{6}$'`;
  assert.deepEqual(rows.map(r => r.name), []);
}
test('renamed app DB and claimed schema cannot authorize fixtures', () => {
  process.env.VERIFY_ISOLATED_SCHEMA = '1'; process.env.VERIFY_ALLOW_SHARED_DB = '1';
  for (const name of ['socialmint','postial','renamed_customer_database']) {
    assert.throws(() => assertVerificationDatabase(`postgres://app:unused@127.0.0.1:55439/${name}`), /Refusing/);
  }
});
test('test-looking name does not authorize privileged actual session', async () => {
  await admin.unsafe('create database postial_verify_123_abcdef');
  try {
    const url = new URL(source); url.pathname = '/postial_verify_123_abcdef';
    assert.throws(() => assertVerificationDatabase(url.href), /Refusing/);
  } finally { await admin.unsafe('drop database postial_verify_123_abcdef'); }
});
test('actual dedicated role works; wrong search path and extra DB access fail closed', async () => {
  const db = await createIsolatedDatabase(source, { migrate: async () => {} });
  try {
    assert.doesNotThrow(() => assertVerificationDatabase(db.url));
    const bad = new URL(db.url); bad.searchParams.set('options', '-c search_path=pg_catalog');
    assert.throws(() => assertVerificationDatabase(bad.href), /Refusing/);
    await admin.unsafe(`grant connect on database postgres to ${db.name}`);
    assert.throws(() => assertVerificationDatabase(db.url), /Refusing/);
    await admin.unsafe(`revoke connect on database postgres from ${db.name}`);
  } finally { await db.cleanup(); }
  await clean();
});
test('migration setup failure removes exact database and role', async () => {
  await assert.rejects(createIsolatedDatabase(source, { migrate: async () => { throw new Error('deliberate setup failure'); } }), /deliberate setup failure/);
  await clean();
});
test('SIGINT during real child migration is handled before suite setup completes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'postial-audit-'));
  mkdirSync(join(dir, 'scripts'));
  writeFileSync(join(dir, 'scripts/migrate.mjs'), "console.log('AUDIT_MIGRATION_ENTERED');setInterval(()=>{},1000);");
  const child = spawn(process.execPath, [new URL('./verify-suite.mjs', import.meta.url).pathname, 'db'], {
    cwd: dir, env: { PATH: process.env.PATH, VERIFY_ADMIN_DATABASE_URL: source }, stdio: ['ignore','pipe','pipe'],
  });
  let output = ''; child.stdout.on('data', b => { output += b; }); child.stderr.on('data', b => { output += b; });
  const exited = once(child, 'exit');
  try {
    for (let i=0; !output.includes('AUDIT_MIGRATION_ENTERED'); i++) {
      assert(i<100 && child.exitCode === null, output); await new Promise(r => setTimeout(r,50));
    }
    child.kill('SIGINT');
    const timer = setTimeout(() => child.kill('SIGKILL'), 10000);
    const [code, signal] = await exited; clearTimeout(timer);
    assert.equal(signal, null, output); assert.equal(code, 130, output);
    await clean();
  } finally { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); rmSync(dir,{recursive:true,force:true}); }
});
test('post-migration setup failure also cleans database and role', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'postial-audit-'));
  mkdirSync(join(dir, 'scripts'));
  writeFileSync(join(dir, 'scripts/migrate.mjs'), '');
  const file = join(dir,'not-a-directory'); writeFileSync(file, 'audit');
  const child = spawn(process.execPath, [new URL('./verify-suite.mjs', import.meta.url).pathname, 'db'], {
    cwd: dir, env: { PATH: process.env.PATH, VERIFY_ADMIN_DATABASE_URL: source, VERIFY_EVIDENCE_DIR: file }, stdio: 'ignore',
  });
  try { const [code] = await once(child, 'exit'); assert.equal(code,1); await clean(); }
  finally { rmSync(dir,{recursive:true,force:true}); }
});
