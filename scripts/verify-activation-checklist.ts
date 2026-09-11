import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { channels, posts, sessions, users, workspaces } from "../db/schema";

const base = process.env.VERIFY_BASE_URL ?? "http://localhost:3992";
const evidence = process.env.VERIFY_EVIDENCE_DIR ?? "work";
const userId = crypto.randomUUID();
const sessionToken = crypto.randomUUID();

async function main() {
  mkdirSync(evidence, { recursive: true });
  const db = getDb();
  await db.insert(users).values({ id: userId, name: "Activation fixture", email: `${userId}@example.invalid` });
  await db.insert(sessions).values({ userId, sessionToken, expires: new Date(Date.now() + 300_000) });
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "/usr/bin/google-chrome", headless: true, args: ["--no-sandbox"] });
  const context = await browser.newContext({ storageState: undefined, viewport: { width: 1280, height: 900 } });
  await context.addCookies([{ name: "authjs.session-token", value: sessionToken, url: base }]);
  const page = await context.newPage();
  const capture = async (name: string) => {
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.screenshot({ path: `${evidence}/${name}-${width}.png`, fullPage: true });
    }
    await page.setViewportSize({ width: 1280, height: 900 });
  };
  try {
    await page.goto(`${base}/app`);
    await page.getByRole("heading", { name: "Overview" }).waitFor();
    const checklist = page.getByRole("list", { name: "Getting started" });
    assert.equal(await checklist.getByRole("listitem").count(), 3);
    assert.equal(await page.getByRole("link", { name: "Create brand" }).getAttribute("href"), "/app/brands");
    assert.equal(await page.getByRole("link", { name: "Connect channel" }).getAttribute("href"), "/app/brands");
    assert.equal(await page.getByRole("link", { name: "Plan post" }).getAttribute("href"), "/app/posts/new");
    await capture("01-fresh-open");

    await page.getByRole("link", { name: "Create brand" }).click();
    // Connecting a channel means leaving Postial to create credentials on the network's own
    // site, and it can fail for reasons outside our product. Drafting and client approval need
    // no channel, so that hurdle belongs last: a new user must reach what makes us different
    // before meeting it. Assert the rendered order so this cannot be undone by accident.
    const titles = (await checklist.innerText()).split("\n").map(line => line.trim());
    const position = (needle: string) => titles.findIndex(line => line.startsWith(needle));
    assert.ok(position("Create a brand") >= 0, "the checklist lists the brand step");
    assert.ok(position("Plan your first post") > position("Create a brand"), "the first post comes after the brand");
    assert.ok(position("Connect a channel") > position("Plan your first post"), "connecting a channel stays last");

    await page.getByRole("heading", { name: "Create your first brand" }).waitFor();
    await page.getByLabel("Name").fill("Activation fixture brand");
    await Promise.all([page.waitForURL(/\/app\/brands\/[0-9a-f-]+/), page.getByRole("button", { name: "Create brand" }).click()]);
    const brandId = new URL(page.url()).pathname.split("/").pop()!;
    await page.goto(`${base}/app`);
    assert.equal(await page.getByRole("link", { name: "Connect channel" }).getAttribute("href"), `/app/brands/${brandId}#connect`);
    assert((await checklist.innerText()).includes("Done"));
    await capture("02-brand-done");

    await db.insert(channels).values({ brandId, provider: "bluesky", displayName: "Fixture channel", externalId: "activation-fixture", credentialsEnc: "fixture", status: "active" });
    await page.reload();
    assert.equal(await page.getByRole("link", { name: "Plan post" }).getAttribute("href"), "/app/posts/new");
    await capture("03-channel-done");

    await db.insert(posts).values({ brandId, authorUserId: userId, body: "Activation fixture post" });
    await page.reload();
    assert.equal(await page.getByRole("list", { name: "Getting started" }).count(), 0, "checklist disappears after all three DB states are complete");
    await capture("04-complete-hidden");
    console.log("PASS activation checklist: 3 open → brand done → channel done → post done and checklist hidden");
  } finally {
    await browser.close();
    await db.delete(workspaces).where(eq(workspaces.ownerUserId, userId));
    await db.delete(users).where(eq(users.id, userId));
    await db.$client.end();
  }
}
main().catch((error) => { console.error("FAIL activation checklist:", error); process.exitCode = 1; });
