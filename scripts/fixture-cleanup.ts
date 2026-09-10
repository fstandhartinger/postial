import { inArray, type SQL } from 'drizzle-orm';
import { getDb } from '../db';
import { users, workspaces } from '../db/schema';
import { assertVerificationDatabase } from './isolated-db.mjs';
assertVerificationDatabase();

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
