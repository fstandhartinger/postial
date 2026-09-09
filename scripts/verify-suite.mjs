import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdirSync, openSync, closeSync } from 'node:fs';
import { resolve } from 'node:path';

const mode = process.argv[2];
if (!['db', 'http'].includes(mode)) throw new Error('Usage: verify-suite.mjs db|http');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL must point to a migrated disposable test database');
// Fixtures may run retention and worker batches: never use a production database.
// Do not pass provider credentials or delivery configuration to any child.
const env = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'DATABASE_URL', 'APP_ENCRYPTION_KEY', 'APP_ENCRYPTION_KEYS',
  'CHROME_PATH', 'PLAYWRIGHT_MODULE', 'AXE_PATH'].filter(k => process.env[k]).map(k => [k, process.env[k]]));
Object.assign(env, {
  AUTH_SECRET: randomBytes(32).toString('hex'), CRON_SECRET: randomBytes(32).toString('hex'),
  STRIPE_SECRET_KEY: 'sk_test_fixture', STRIPE_WEBHOOK_SECRET: 'whsec_fixture',
  STRIPE_PRICE_STARTER: 'price_fixture_starter', STRIPE_PRICE_AGENCY: 'price_fixture_agency',
  STRIPE_PORTAL_CONFIG: 'bpc_fixture', WORKER_ENABLED: 'false', AUTH_TRUST_HOST: 'true',
  APPROVAL_TRUST_PROXY: 'true', PLAYWRIGHT_MODULE: env.PLAYWRIGHT_MODULE || 'playwright',
  VERIFY_EVIDENCE_DIR: resolve(process.env.VERIFY_EVIDENCE_DIR || '../work/verification'),
  APP_URL: 'http://localhost:3992', AUTH_URL: 'http://localhost:3992', NEXT_PUBLIC_APP_URL: 'http://localhost:3992',
});
if (!env.APP_ENCRYPTION_KEY && !env.APP_ENCRYPTION_KEYS) env.APP_ENCRYPTION_KEY = randomBytes(32).toString('base64');
mkdirSync(env.VERIFY_EVIDENCE_DIR, { recursive: true });
// DB/unit verifiers run without an app server. Browser verifiers (including C8,
// which also creates DB fixtures) belong to the managed standalone HTTP suite.
const db = ['entitlements', 'workspace', 'webhook', 'publishers', 'core', 'api', 'oauth', 'pilot', 'retention', 'bulk', 'c6', 'c7', 'fixer3-migration'];
  const http = ['http.mjs', 'marketing.mjs', 'docs', 'core-http', 'billing', 'api', 'approvals', 'team', 'media',
    'waitlist', 'appshell', 'bulk', 'c6', 'c7', 'c8', 'fixer-browser.mjs', 'fixer2-browser', 'fixer3-browser',
    'docs-browser.mjs', 'marketing-browser.mjs', 'login-browser'];
let server, active;
async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const done = once(child, 'exit');
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
  await done;
  clearTimeout(timer);
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => {
  await stop(active); await stop(server); process.exit(signal === 'SIGINT' ? 130 : 143);
});
async function run(name) {
  const file = `scripts/verify-${name.includes('.') ? name : name + '.ts'}`;
  console.log(`VERIFY ${file}`);
  active = spawn(process.execPath, ['--import', 'tsx', file], { env, stdio: 'inherit' });
  const child = active;
  const timer = setTimeout(() => { void stop(child); }, 300_000);
  const [code, signal] = await once(active, 'exit');
  clearTimeout(timer); active = undefined;
  if (code !== 0) throw new Error(`${file} failed (${signal || code})`);
}
try {
  if (mode === 'http') {
    const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
    const port = probe.address().port; await new Promise(r => probe.close(r));
    const base = `http://localhost:${port}`;
    Object.assign(env, { VERIFY_BASE_URL: base, APP_URL: base, AUTH_URL: base, NEXT_PUBLIC_APP_URL: base });
    const log = openSync(resolve(env.VERIFY_EVIDENCE_DIR, 'standalone.log'), 'w', 0o600);
    server = spawn(process.execPath, ['.next/standalone/server.js'], {
      env: { ...env, NODE_ENV: 'production', PORT: String(port), HOSTNAME: '127.0.0.1' }, stdio: ['ignore', log, log],
    });
    closeSync(log);
    let ready = false;
    for (let i = 0; i < 120; i++) {
      if (server.exitCode !== null) throw new Error('Standalone exited; inspect private standalone.log');
      try { ready = (await fetch(base + '/healthz', { signal: AbortSignal.timeout(2000) })).ok; } catch { /* starting */ }
      if (ready) break;
      await new Promise(r => setTimeout(r, 500));
    }
    if (!ready) throw new Error('Standalone readiness failed; inspect private standalone.log');
    console.log(`Standalone ready at ${base}`);
  }
  const failures = [];
  for (const name of mode === 'db' ? db : http) {
    try { await run(name); } catch (error) { failures.push(error.message); console.error(error.message); }
  }
  if (failures.length) throw new Error(failures.join('\n'));
  console.log(`PASS verify:${mode === 'db' ? 'all' : 'http'}`);
} finally { await stop(active); await stop(server); }
