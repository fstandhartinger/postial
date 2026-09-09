// Shared origin takes precedence; historical per-script variables remain supported.
if (process.env.VERIFY_BASE_URL) process.env.BULK_BROWSER_URL = process.env.VERIFY_BASE_URL;
import { deleteFixtureUsers } from './fixture-cleanup';
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { eq, inArray } from "drizzle-orm";
import { getDb } from "../db";
import {
  users,
  workspaces,
  workspaceMembers,
  subscriptions,
  brands,
  channels,
  posts,
  postTargets,
  sessions,
} from "../db/schema";
import { saveBulk } from "../lib/api/bulk";
import { createApiKey } from "../lib/api/auth";
import { POST } from "../app/api/v1/posts/bulk/route";
import { POST as singlePost } from "../app/api/v1/posts/route";
import {
  CSV_HEADER,
  importCsv,
  parseCsv,
  distribute,
  rowErrors,
} from "../lib/bulk";
import { localDateTime } from "../lib/timezone";
async function main() {
  assert.notEqual(process.env.NODE_ENV, "production");
  const db = getDb(),
    userId = crypto.randomUUID();
  try {
    await db.insert(users).values({ id: userId, name: "Bulk verification" });
    const [workspace] = await db
      .insert(workspaces)
      .values({
        name: "Bulk studio",
        slug: "bulk-" + userId,
        ownerUserId: userId,
      })
      .returning();
    await db
      .insert(workspaceMembers)
      .values({ workspaceId: workspace.id, userId, role: "owner" });
    await db
      .insert(subscriptions)
      .values({
        workspaceId: workspace.id,
        plan: "agency",
        status: "trialing",
        trialEnd: new Date(Date.now() + 86400000),
        stripeSubscriptionId: "bulk-test-" + userId,
      });
    const [brand] = await db
      .insert(brands)
      .values({
        workspaceId: workspace.id,
        name: "Bulk studio",
        slug: "bulk",
        timezone: "Europe/Berlin",
      })
      .returning();
    const [channel] = await db
      .insert(channels)
      .values({
        brandId: brand.id,
        provider: "mastodon",
        displayName: "Studio Mastodon",
        externalId: userId,
        credentialsEnc: "unused-fixture",
        meta: { maxTextLength: 500 },
      })
      .returning();
    const ctx = { db, workspace, userId },
      c = { ...channel, max: 500 };
    const row = {
      brand_id: brand.id,
      body: "Weekly post",
      channel_ids: [channel.id],
      scheduled_at: "2030-01-07T09:00:00+01:00",
    };
    const five = await saveBulk(
      ctx,
      Array.from({ length: 5 }, (_, i) => ({ ...row, body: `Five ${i}` })),
    );
    assert.equal(five.filter((r) => r.id).length, 5);
    const ids = five.map((r) => r.id!);
    assert.equal(
      (await db.select().from(posts).where(inArray(posts.id, ids))).length,
      5,
    );
    assert.equal(
      (
        await db
          .select()
          .from(postTargets)
          .where(inArray(postTargets.postId, ids))
      ).length,
      5,
    );
    const partial = await saveBulk(ctx, [
      row,
      { ...row, body: "x".repeat(501) },
      row,
    ]);
    assert.deepEqual(
      partial.map((r) => r.status),
      [201, 422, 201],
    );
    const absoluteLimit = await saveBulk(ctx, [{ ...row, body: "x".repeat(10001), channel_ids: [] }]);
    assert.equal(absoluteLimit[0].status, 422);
    assert.equal(absoluteLimit[0].error?.code, "validation_error");
    assert.equal(absoluteLimit[0].error?.message, "Post text must be 10,000 characters or fewer");
    assert.equal(
      (await db.select().from(posts).where(eq(posts.brandId, brand.id))).length,
      7,
    );
    console.log(
      "PASS five scheduled posts and targets; long row fails independently",
    );
    const csv =
      "\uFEFF" +
      CSV_HEADER.replaceAll(",", ";") +
      '\r\n2030-01-07;09:00;"Hello; world\nwith ""quotes""";mastodon;;false\r\n';
    const imported = importCsv(csv, [c]);
    assert.equal(imported.length, 1);
    assert.equal(imported[0].text, 'Hello; world\nwith "quotes"');
    assert.deepEqual(imported[0].channelIds, [channel.id]);
    assert.deepEqual(rowErrors(imported[0], [c], brand.timezone), []);
    assert.throws(
      () =>
        parseCsv(
          CSV_HEADER +
            "\n" +
            Array(201).fill("2030-01-07,09:00,test,mastodon,,false").join("\n"),
        ),
      /200/,
    );
    assert.throws(() => parseCsv(CSV_HEADER + '\n"unclosed'), /quote/);
    assert.equal(
      importCsv(CSV_HEADER + "\n2030-01-07,09:00,test,unknown,,maybe", [c])[0]
        .importErrors?.length,
      2,
    );
    const distribution = distribute(
      5,
      "2030-01-07",
      3,
      ["09:00", "17:00"],
      brand.timezone,
    );
    assert.deepEqual(distribution, [
      "2030-01-07T09:00",
      "2030-01-07T17:00",
      "2030-01-08T17:00",
      "2030-01-09T09:00",
      "2030-01-09T17:00",
    ]);
    assert.equal(
      localDateTime(distribution[0], brand.timezone).toISOString(),
      "2030-01-07T08:00:00.000Z",
    );
    assert.equal(
      localDateTime(
        distribute(1, "2030-07-07", 1, ["09:00"], brand.timezone)[0],
        brand.timezone,
      ).toISOString(),
      "2030-07-07T07:00:00.000Z",
    );
    assert.throws(
      () => distribute(1, "2030-03-31", 1, ["02:30"], brand.timezone),
      /daylight/,
    );
    assert.throws(
      () => distribute(1, "2030-10-27", 1, ["02:30"], brand.timezone),
      /daylight/,
    );
    assert.throws(
      () => distribute(3, "2030-01-01", 1, ["09:00"], brand.timezone),
      /more/,
    );
    console.log(
      "PASS BOM/semicolon CSV, quoting, row limit, timezone distribution and DST gaps/folds",
    );
    const key = await createApiKey(workspace.id, userId, "Bulk test", [
      "posts:write",
    ]);
    const request = (data: unknown, idem?: string) =>
      new Request("http://localhost/api/v1/posts/bulk", {
        method: "POST",
        headers: {
          authorization: "Bearer " + key.token,
          "Content-Type": "application/json",
          ...(idem ? { "Idempotency-Key": idem } : {}),
        },
        body: JSON.stringify(data),
      });
    assert.equal((await POST(request(Array(201).fill(row)))).status, 422);
    assert.equal((await POST(request([]))).status, 422);
    assert.equal((await POST(request([row], "bad key"))).status, 422);
    const payload = [row, { ...row, body: "x".repeat(501) }, row];
    const replies = await Promise.all(
      Array.from({ length: 8 }, () => POST(request(payload, "bulk-idem"))),
    );
    replies.forEach((r) => assert.equal(r.status, 200));
    const bodies = await Promise.all(replies.map((r) => r.json()));
    bodies.forEach((b) => assert.deepEqual(b, bodies[0]));
    assert.deepEqual(
      bodies[0].data.map((r: { status: number }) => r.status),
      [201, 422, 201],
    );
    assert.equal(
      (await db.select().from(posts).where(eq(posts.brandId, brand.id))).length,
      9,
    );
    assert.equal((await POST(request([row], "bulk-idem"))).status, 409);
    assert.equal((await singlePost(request(row, "bulk-idem"))).status, 409);
    const unsafe = await saveBulk(ctx, [
      { ...row, media_urls: ["https://127.0.0.1/private"] },
      {
        ...row,
        media_urls: ["https://example.com/a", "https://example.com/b"],
      },
      { ...row, channel_ids: [crypto.randomUUID()] },
    ]);
    assert.deepEqual(
      unsafe.map((r) => r.status),
      [422, 422, 404],
    );
    await db
      .update(subscriptions)
      .set({ plan: "starter" })
      .where(eq(subscriptions.workspaceId, workspace.id));
    assert.equal((await saveBulk(ctx, [row]))[0].status, 201);
    assert.equal(
      (await saveBulk(ctx, [{ ...row, requires_approval: true }]))[0].status,
      422,
    );
    await db
      .update(subscriptions)
      .set({ trialEnd: new Date(0) })
      .where(eq(subscriptions.workspaceId, workspace.id));
    assert.equal((await saveBulk(ctx, [row]))[0].status, 422);
    const draft = { ...row, scheduled_at: undefined };
    assert.equal((await saveBulk(ctx, [draft]))[0].status, 201);
    await db
      .update(subscriptions)
      .set({ plan: "agency", trialEnd: new Date(Date.now() + 86400000) })
      .where(eq(subscriptions.workspaceId, workspace.id));
    console.log(
      "PASS API 201-row rejection, concurrent idempotency, conflict, SSRF, tenancy and Starter/draft entitlement rules",
    );
    if (process.env.BULK_BROWSER_URL) {
      const modulePath =
        process.env.PLAYWRIGHT_MODULE ||
        "playwright";
      const { chromium } = await import(modulePath);
      const browser = await chromium.launch({
        executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
        headless: true,
        args: ["--no-sandbox"],
      });
      try {
        const base = process.env.BULK_BROWSER_URL,
          token = randomBytes(32).toString("base64url");
        await db
          .insert(sessions)
          .values({
            sessionToken: token,
            userId,
            expires: new Date(Date.now() + 600000),
          });
        mkdirSync((process.env.VERIFY_EVIDENCE_DIR || "../work") + "/bulk-evidence", { recursive: true });
        for (const width of [390, 1280]) {
          const context = await browser.newContext({
            viewport: { width, height: 900 },
          });
          await context.addCookies([
            { name: "authjs.session-token", value: token, url: base },
          ]);
          const page = await context.newPage();
          const errors: string[] = [];
          page.on("pageerror", (e: Error) => errors.push(e.message));
          await page.goto(base + "/app/posts/bulk?brand=" + brand.id);
          await page
            .getByRole("heading", { name: "Plan several posts", exact: true })
            .waitFor();
          await page
            .getByLabel("Post 1", { exact: true })
            .fill("A week of stories from the studio.");
          await page
            .getByLabel("Start date", { exact: true })
            .fill("2030-01-07");
          await page
            .getByRole("button", { name: "Add row", exact: true })
            .click();
          await page
            .getByLabel("Post 2", { exact: true })
            .fill("A second story.");
          await page
            .getByRole("button", { name: "Auto-distribute", exact: true })
            .click();
          assert.equal(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth + 1,
            ),
            true,
            "Bulk page must fit viewport",
          );
          await page.screenshot({
            path: `${process.env.VERIFY_EVIDENCE_DIR || '../work'}/bulk-evidence/editor-${width}.png`,
            fullPage: true,
          });
          await page
            .getByLabel("Choose CSV", { exact: true })
            .setInputFiles({
              name: "week.csv",
              mimeType: "text/csv",
              buffer: Buffer.from(
                csv +
                  "2030-01-08;10:00;" +
                  "x".repeat(501) +
                  ";mastodon;;false\r\n",
              ),
            });
          await page
            .getByRole("heading", { name: "CSV preview · 2 posts" })
            .waitFor();
          assert.match(
            await page.getByRole("region", { name: "CSV import" }).innerText(),
            /supports 500 characters/,
          );
          assert.equal(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth + 1,
            ),
            true,
            "Bulk page must fit viewport",
          );
          await page.screenshot({
            path: `${process.env.VERIFY_EVIDENCE_DIR || '../work'}/bulk-evidence/csv-${width}.png`,
            fullPage: true,
          });
          await page
            .getByRole("button", { name: "Use CSV rows in editor" })
            .click();
          await page
            .getByRole("button", { name: "Schedule posts", exact: true })
            .click();
          await page
            .getByRole("status")
            .filter({ hasText: "1 scheduled" })
            .waitFor();
          assert.equal(
            await page
              .getByRole("link", { name: "scheduled — Open post" })
              .count(),
            1,
          );
          assert.deepEqual(errors, []);
          await context.close();
        }
      } finally {
        await browser.close();
      }
      console.log(
        "PASS Playwright 390/1280 editor, CSV preview, partial server-action save, no page overflow or runtime errors",
      );
    }
  } finally {
    await deleteFixtureUsers(db).where(eq(users.id, userId));
  }
}
main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : "Bulk verification failed");
    process.exit(1);
  });
