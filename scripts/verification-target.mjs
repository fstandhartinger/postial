import postgres from 'postgres';

// Read-only verification of the actual session, not an operator's env claim.
export async function validateTarget(url) {
  const parsed = new URL(url);
  const name = parsed.pathname.slice(1);
  if (!/^postial_verify_[0-9]+_[a-f0-9]{6}$/.test(name)) throw new Error('Refusing verification target name');
  const db = postgres(url, { max: 1, prepare: false, connect_timeout: 3 });
  try {
    const [r] = await db`select current_database() as database, current_user as role,
      current_schemas(false) as schemas, r.rolsuper, r.rolcreatedb, r.rolcreaterole,
      r.rolbypassrls, r.rolinherit,
      (select count(*)::int from pg_auth_members where member=r.oid) as memberships,
      (select pg_get_userbyid(datdba) from pg_database where datname=current_database()) as owner,
      (select count(*)::int from pg_database where datallowconn and datname<>current_database()
        and has_database_privilege(current_user,oid,'CONNECT')) as other_databases
      from pg_roles r where rolname=current_user`;
    if (r.database !== name || r.role !== name || r.owner !== name || r.rolsuper || r.rolcreatedb || r.rolcreaterole || r.rolbypassrls || r.rolinherit || r.memberships || r.other_databases || JSON.stringify(r.schemas) !== '["public"]') {
      throw new Error('Refusing verification target: session, search_path or role is not isolated');
    }
  } finally { await db.end(); }
}
if (process.argv[1]?.endsWith('verification-target.mjs')) {
  validateTarget(process.env.DATABASE_URL).catch(() => { console.error('Refusing verification target: actual isolation validation failed'); process.exitCode = 1; });
}
