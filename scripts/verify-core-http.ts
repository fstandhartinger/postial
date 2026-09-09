// Shared origin takes precedence; historical per-script variables remain supported.
if (process.env.VERIFY_BASE_URL) process.env.CORE_HTTP_URL = process.env.VERIFY_BASE_URL;
import { deleteFixtureUsers } from './fixture-cleanup';
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { users, sessions } from "../db/schema";
async function main() {
  const db = getDb(),
    id = crypto.randomUUID(),
    token = crypto.randomUUID(),
    base = process.env.CORE_HTTP_URL ?? "http://localhost:3993";
  try {
    await db.insert(users).values({ id, name: "HTTP fixture" });
    await db
      .insert(sessions)
      .values({
        sessionToken: token,
        userId: id,
        expires: new Date(Date.now() + 60000),
      });
    for (const path of [
      "/app",
      "/app/brands",
      "/app/posts/new",
      "/app/calendar",
      "/app/posts",
    ]) {
      assert.equal(
        (await fetch(base + path, { redirect: "manual" })).status,
        307,
        path + " anonymous",
      );
      const response = await fetch(base + path, {
        redirect: "manual",
        headers: { cookie: `authjs.session-token=${token}` },
      });
      assert.equal(response.status, 200, path + " authenticated");
      const html = await response.text();
      assert(!html.includes("credentialsEnc"));
      assert(html.includes("Calendar"));
    }
    assert.equal(
      (await fetch(base + "/api/internal/tick", { method: "POST" })).status,
      401,
    );
    console.log(
      "PASS: five authenticated pages 200, anonymous pages 307, cron without secret 401",
    );
  } finally {
    await deleteFixtureUsers(db).where(eq(users.id, id));
    await db.$client.end();
  }
}
main().catch(() => {
  console.error("Core HTTP verification failed");
  process.exitCode = 1;
});
