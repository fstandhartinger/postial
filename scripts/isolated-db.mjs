import postgres from 'postgres';
import { randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { validateTarget } from './verification-target.mjs';

export function databaseName(url = process.env.DATABASE_URL) {
  if (!url) throw new Error('DATABASE_URL is required');
  return new URL(url).pathname.slice(1) || '';
}
export function assertVerificationDatabase(url = process.env.DATABASE_URL) {
  if (!/^postial_verify_[0-9]+_[a-f0-9]{6}$/.test(databaseName(url))) {
    throw new Error('Refusing verifier: use a dedicated verification database and role, not a shared schema or bypass flag.');
  }
  const checked = spawnSync(process.execPath, [new URL('./verification-target.mjs', import.meta.url).pathname], {
    env: { PATH: process.env.PATH, DATABASE_URL: url }, encoding: 'utf8', timeout: 10000,
  });
  if (checked.status !== 0) throw new Error('Refusing verifier: actual database/session isolation validation failed');
}

export async function migrateVerificationDatabase(url, signal) {
  signal?.throwIfAborted();
  const child = spawn(process.execPath, ['scripts/migrate.mjs'], {
    env: { PATH: process.env.PATH, DATABASE_URL: url }, stdio: 'inherit',
  });
  let timer;
  const stop = () => { child.kill('SIGTERM'); timer = setTimeout(() => child.kill('SIGKILL'), 5000); };
  signal?.addEventListener('abort', stop, { once: true });
  try {
    const [code, killed] = await once(child, 'exit');
    signal?.throwIfAborted();
    if (code !== 0) throw new Error(`Database migration failed (${killed || code})`);
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', stop); }
}

/** Dedicated disposable server only. No port rewriting, production credentials or schema fallback.
 * The administrator must pre-revoke PUBLIC CONNECT on its bootstrap databases.
 * Each fixture role is unable to connect to any other database on that server.
 */
export async function createIsolatedDatabase(source = process.env.VERIFY_ADMIN_DATABASE_URL, { signal, migrate = migrateVerificationDatabase } = {}) {
  if (!source) throw new Error('VERIFY_ADMIN_DATABASE_URL is required (dedicated disposable server)');
  const parsed = new URL(source);
  if (databaseName(source) !== 'postial_verify_admin' || parsed.username !== 'postial_verify_admin' || parsed.search) {
    throw new Error('Refusing bootstrap: dedicated postial_verify_admin database/role required');
  }
  const admin = postgres(source, { prepare: false, max: 1, connect_timeout: 3 });
  const name = `postial_verify_${Date.now()}_${randomBytes(3).toString('hex')}`;
  const password = randomBytes(24).toString('hex');
  let roleCreated = false, databaseCreated = false, cleaning;
  async function cleanup() {
    return cleaning ??= (async () => {
      try {
        if (databaseCreated) await admin.unsafe(`drop database if exists ${name} with (force)`);
        if (roleCreated) await admin.unsafe(`drop role if exists ${name}`);
      } finally { await admin.end(); }
    })();
  }
  try {
    signal?.throwIfAborted();
    const [session] = await admin`select current_database() as database, current_user as role`;
    if (session.database !== 'postial_verify_admin' || session.role !== 'postial_verify_admin') throw new Error('Refusing bootstrap session mismatch');
    await admin.unsafe(`create role ${name} login password '${password}' nosuperuser nocreatedb nocreaterole noinherit nobypassrls`);
    roleCreated = true;
    signal?.throwIfAborted();
    await admin.unsafe(`create database ${name} owner ${name} template template0`);
    databaseCreated = true;
    await admin.unsafe(`revoke connect on database ${name} from public`);
    parsed.pathname = '/' + name; parsed.username = name; parsed.password = password;
    const url = parsed.href;
    signal?.throwIfAborted();
    await validateTarget(url);
    await migrate(url, signal);
    signal?.throwIfAborted();
    return { url, name, mode: 'database', cleanup };
  } catch (error) {
    try { await cleanup(); } catch (cleanupError) { throw new AggregateError([error, cleanupError], `Setup failed; cleanup also failed for ${name}`); }
    throw error;
  }
}

if (process.argv[1]?.endsWith('isolated-db.mjs')) {
  const controller = new AbortController();
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { process.exitCode = signal === 'SIGINT' ? 130 : 143; controller.abort(); });
  createIsolatedDatabase(undefined, { signal: controller.signal }).then(async db => {
    console.log(JSON.stringify({ mode: db.mode, database: db.name })); await db.cleanup();
  }).catch(error => { console.error(error.message); process.exitCode ||= 1; });
}
