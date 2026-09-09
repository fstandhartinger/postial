import postgres from 'postgres';

const apply = process.argv.includes('--apply');
if (process.argv.slice(2).some(arg => !['--apply', '--dry-run'].includes(arg))) {
  console.error('Usage: npx tsx scripts/fixture-sweep.ts [--dry-run|--apply]'); process.exit(2);
}
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const database = new URL(process.env.DATABASE_URL).pathname.slice(1);
if (database === 'socialmint' && process.env.VERIFY_ALLOW_SHARED_DB !== '1') {
  throw new Error('Refusing fixture sweep against production database "socialmint". Set VERIFY_ALLOW_SHARED_DB=1 for an explicit sweep.');
}

const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });
const workspaceTables: [string, string][] = [
  ['workspace_members', 'workspace_id'], ['subscriptions', 'workspace_id'], ['brands', 'workspace_id'],
  ['media_assets', 'workspace_id'], ['webhook_endpoints', 'workspace_id'], ['notifications', 'workspace_id'],
  ['workspace_invites', 'workspace_id'], ['dpa_acceptances', 'workspace_id'], ['billing_state', 'workspace_id'],
  ['workspaces', 'id'],
];
async function main() {
try {
  const [{ ids }] = await sql<{ ids: string[] }[]>`select coalesce(array_agg(id::text), array[]::text[]) as ids from workspaces where name in ('C7 fixture', 'fixture:C7') or name ilike 'fixture:%' or id in (select workspace_id from subscriptions where stripe_subscription_id like 'sub_fixture_%')`;
  const fixtureWorkspaceIds = ids || [];
  const counts: Record<string, number> = {};
  for (const [table, column] of workspaceTables) counts[table] = fixtureWorkspaceIds.length ? Number((await sql.unsafe(`select count(*)::int as count from ${table} where ${column}::text = any($1::text[])`, [fixtureWorkspaceIds]))[0].count) : 0;
  counts.users = Number((await sql`select count(*)::int as count from users where email ilike '%@example.invalid' or email ilike '%@fixture.postial.invalid'`)[0].count);
  console.log(`${apply ? 'APPLY' : 'DRY-RUN'} fixture sweep (${fixtureWorkspaceIds.length} workspaces)`);
  for (const [table, count] of Object.entries(counts)) console.log(`${table}: ${count}`);
  if (apply) {
    await sql.begin(async tx => {
      if (fixtureWorkspaceIds.length) await tx`delete from workspaces where id::text = any(${fixtureWorkspaceIds})`;
      await tx`delete from users where email ilike '%@example.invalid' or email ilike '%@fixture.postial.invalid'`;
    });
    console.log('Applied; workspace cascades and marked users removed.');
  }
} finally { await sql.end(); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Fixture sweep failed'); process.exitCode = 1; });
