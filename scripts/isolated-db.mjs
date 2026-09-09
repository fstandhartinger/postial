import postgres from 'postgres';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

export function databaseName(url = process.env.DATABASE_URL) {
  if (!url) throw new Error('DATABASE_URL is required');
  return new URL(url).pathname.slice(1) || '';
}

export function assertVerificationDatabase(url = process.env.DATABASE_URL) {
  const name = databaseName(url);
  if (name === 'socialmint' && process.env.VERIFY_ALLOW_SHARED_DB !== '1') {
    throw new Error('Refusing verifier against production database "socialmint". Run verify:all/verify:http (isolated DB), or set VERIFY_ALLOW_SHARED_DB=1 only for an explicit, reviewed run.');
  }
}

function adminUrl(source) {
  // Managed Postgres instances may omit the conventional `postgres` database;
  // CREATE DATABASE is valid while connected to the source application DB.
  const url = new URL(source);
  url.port = '5432';
  return url.toString();
}

function directUrl(source, database) {
  const url = new URL(source);
  url.port = '5432';
  url.pathname = `/${database}`;
  return url.toString();
}

function withSchema(url, schema) {
  const result = new URL(url);
  result.searchParams.set('options', `-c search_path=${schema},public`);
  return result.toString();
}

async function migrate(url, schema) {
  const child = spawn(process.execPath, ['scripts/migrate.mjs'], { env: { ...process.env, DATABASE_URL: url, ...(schema ? { MIGRATIONS_SCHEMA: schema } : {}) }, stdio: 'inherit' });
  const [code, signal] = await once(child, 'exit');
  if (code !== 0) throw new Error(`Database migration failed (${signal || code})`);
}

export async function createIsolatedDatabase(source = process.env.DATABASE_URL) {
  const admin = postgres(adminUrl(source), { prepare: false, max: 1, connect_timeout: 10 });
  const suffix = `${Date.now()}_${randomBytes(3).toString('hex')}`;
  const name = `postial_verify_${suffix}`;
  let mode = 'database';
  let url;
  let schema;
  let created = false;
  try {
    const [{ rolcreatedb }] = await admin`select rolcreatedb from pg_roles where rolname = current_user`;
    if (rolcreatedb) {
      await admin.unsafe(`create database ${name} template template0`);
      created = true;
      url = directUrl(source, name);
    } else {
      mode = 'schema';
      schema = `verify_${suffix}`;
      await admin.unsafe(`create schema ${schema}`);
      url = withSchema(directUrl(source, databaseName(source)), schema);
    }
    const databaseUrl = url;
    await migrate(databaseUrl, schema);
    return {
      url: databaseUrl,
      name: mode === 'database' ? name : databaseName(source),
      schema: mode === 'schema' ? schema : undefined,
      mode,
      async cleanup() {
        if (mode === 'database') {
          await admin.unsafe(`select pg_terminate_backend(pid) from pg_stat_activity where datname = '${name}' and pid <> pg_backend_pid()`);
          await admin.unsafe(`drop database if exists ${name}`);
        } else {
          await admin.unsafe(`drop schema if exists ${schema} cascade`);
        }
        await admin.end();
      },
    };
  } catch (error) {
    if (created) {
      try {
        await admin.unsafe(`select pg_terminate_backend(pid) from pg_stat_activity where datname = '${name}' and pid <> pg_backend_pid()`);
        await admin.unsafe(`drop database if exists ${name}`);
      } catch { /* preserve the original migration error */ }
    } else if (schema) {
      try { await admin.unsafe(`drop schema if exists ${schema} cascade`); } catch { /* preserve original error */ }
    }
    await admin.end();
    throw error;
  }
}

if (process.argv[1]?.endsWith('isolated-db.mjs')) {
  assertVerificationDatabase();
  const db = await createIsolatedDatabase();
  console.log(JSON.stringify({ mode: db.mode, database: db.name, schema: db.schema || null }));
  await db.cleanup();
}
