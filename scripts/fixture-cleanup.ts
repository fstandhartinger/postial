import { inArray, type SQL } from 'drizzle-orm';
import { getDb } from '../db';
import { users, workspaces } from '../db/schema';
const verificationDb = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL).pathname.slice(1) : '';
if (verificationDb === 'socialmint' && process.env.VERIFY_ALLOW_SHARED_DB !== '1' && process.env.VERIFY_ISOLATED_SCHEMA !== '1') {
  throw new Error('Refusing verifier against production database "socialmint". Use npm run verify:all or verify:http for an isolated run.');
}

export const FIXTURE_EMAIL_DOMAIN = '@fixture.postial.invalid';
export const FIXTURE_WORKSPACE_PREFIX = 'fixture:';

/** Synthetic fixture cleanup must explicitly delete owned workspaces before restricted owner FKs. */
export function deleteFixtureUsers(db:ReturnType<typeof getDb>) {
  return {where: async (condition:SQL|undefined) => {
    if(!condition) throw new Error('Fixture cleanup requires an explicit user predicate');
    await db.delete(workspaces).where(inArray(workspaces.ownerUserId,db.select({id:users.id}).from(users).where(condition)));
    await db.delete(users).where(condition);
  }};
}
