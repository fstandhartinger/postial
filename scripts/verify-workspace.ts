import { deleteFixtureUsers } from './fixture-cleanup';
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { users, workspaces, workspaceMembers, subscriptions } from "../db/schema";
import { ensureWorkspace } from "../lib/workspaces";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { accounts, sessions, verificationTokens } from "../db/schema";
async function main() {
  const db = getDb();
  const id = crypto.randomUUID();
  try {
    await db.insert(users).values({ id, name: "Postial integration fixture" });
    const results = await Promise.all(Array.from({ length: 5 }, () => ensureWorkspace(id)));
    assert.equal(new Set(results.map(w => w.id)).size, 1);
    const owned = await db.select().from(workspaces).where(eq(workspaces.ownerUserId, id));
    assert.equal(owned.length, 1);
    assert.equal(owned[0].name, "My workspace");
    const members = await db.select().from(workspaceMembers).where(eq(workspaceMembers.userId, id));
    assert.equal(members.length, 1);
    assert.equal(members[0].role, "owner");
    const records = await db.select().from(subscriptions).where(eq(subscriptions.workspaceId, owned[0].id));
    assert.equal(records.length, 0);
    const adapter = DrizzleAdapter(db, { usersTable: users, accountsTable: accounts, sessionsTable: sessions, verificationTokensTable: verificationTokens });
    const token = crypto.randomUUID();
    await adapter.createSession!({ sessionToken: token, userId: id, expires: new Date(Date.now() + 60000) });
    const found = await adapter.getSessionAndUser!(token);
    assert.equal(found?.user.id, id);
    await adapter.deleteSession!(token);
    assert.equal(await adapter.getSessionAndUser!(token), null);
    console.log("PASS: concurrent onboarding, owner membership, no unearned trial, database session lifecycle");
  } finally {
    await deleteFixtureUsers(db).where(eq(users.id, id));
    await db.$client.end();
  }
}
main().catch(() => { console.error("Workspace integration verification failed"); process.exitCode = 1; });
