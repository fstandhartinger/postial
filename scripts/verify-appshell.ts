// Shared origin takes precedence; historical per-script variables remain supported.
if (process.env.VERIFY_BASE_URL) process.env.APPSHELL_HTTP_URL = process.env.VERIFY_BASE_URL;
import { deleteFixtureUsers } from './fixture-cleanup';
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import {
  users,
  sessions,
  subscriptions,
  brands,
  channels,
  posts,
  postTargets,
} from "../db/schema";
import { ensureWorkspace } from "../lib/workspaces";
import { encryptCredentials } from "../lib/crypto";
import { inZone } from "../lib/timezone";
async function main() {
  const modulePath =
    process.env.PLAYWRIGHT_MODULE ||
    "playwright";
  const { chromium } = await import(modulePath);
  const db = getDb(),
    uid = crypto.randomUUID(),
    token = crypto.randomUUID();
  const base = process.env.APPSHELL_HTTP_URL || "http://localhost:3997",
    evidence = (process.env.VERIFY_EVIDENCE_DIR || "../work") + "/appshell-evidence";
  mkdirSync(evidence, { recursive: true });
  const browser = await chromium.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox"],
  });
  let stage = "fixtures";
  try {
    await db.insert(users).values({ id: uid, name: "Maple Studio owner" });
    const workspace = await ensureWorkspace(uid);
    await db.insert(sessions).values({
      sessionToken: token,
      userId: uid,
      expires: new Date(Date.now() + 3600000),
    });
    await db.insert(subscriptions).values({
      workspaceId: workspace.id,
      plan: "agency",
      status: "active",
      stripeSubscriptionId: "fixture-appshell-" + uid,
      currentPeriodEnd: new Date(Date.now() + 86400000),
    });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      permissions: ["clipboard-read", "clipboard-write"],
    });
    await context.addCookies([
      { name: "authjs.session-token", value: token, url: base },
    ]);
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", () => errors.push("pageerror"));
    page.on("console", (msg: { type(): string }) => {
      if (msg.type() === "error") errors.push("console.error");
    });
    stage = "empty onboarding";
    await page.goto(base + "/app");
    await page
      .getByRole("heading", { name: "Overview", exact: true })
      .waitFor();
    assert.equal(await page.locator(".site-header, .site-footer").count(), 0);
    assert.equal(await page.getByRole("list", { name: "Getting started" }).getByRole("listitem").count(), 3);
    assert.equal(await page.getByText("0 of 3 steps complete", { exact: true }).count(), 1);
    await page.getByRole("link", { name: "Create brand", exact: true }).click();
    await page.getByLabel("Name", { exact: true }).fill("Maple Studio");
    await page
      .getByRole("button", { name: "Create brand", exact: true })
      .click();
    await page.waitForURL(/\/app\/brands\/[a-f0-9-]+$/);
    const [brand] = await db
      .select()
      .from(brands)
      .where(eq(brands.workspaceId, workspace.id));
    stage = "invalid connection preserves fields";
    await page.locator("[name=provider]").selectOption("mastodon");
    await page
      .getByLabel("Instance URL", { exact: true })
      .fill("http://invalid.example");
    await page
      .getByLabel("Access token", { exact: false })
      .fill("synthetic-invalid-credential");

    await page
      .getByRole("button", { name: "Connect channel", exact: true })
      .click();
    await page.locator("form [role=alert]").waitFor();
    assert.equal(
      await page.getByLabel("Instance URL", { exact: true }).inputValue(),
      "http://invalid.example",
    );
    assert.equal(
      await page.getByLabel("Access token", { exact: false }).inputValue(),
      "synthetic-invalid-credential",
    );
    assert((await page.locator("form [role=alert]").innerText()).length > 15);
    await page.screenshot({
      path: evidence + "/connection-error-1280.png",
      fullPage: true,
    });
    // Successful provider auth is out of scope: use an isolated synthetic active channel.
    const [channel] = await db
      .insert(channels)
      .values({
        brandId: brand.id,
        provider: "mastodon",
        displayName: "Maple community",
        externalId: "fixture-appshell",
        credentialsEnc: encryptCredentials({
          accessToken: "synthetic",
          instanceUrl: "https://fixture.invalid",
        }),
        meta: { maxTextLength: 500 },
      })
      .returning();
    stage = "draft and schedule";
    await page.goto(base + "/app/posts/new?brand=" + brand.id);
    await page
      .getByLabel("Post text", { exact: true })
      .fill(
        "A fresh look for your next chapter. Our new studio portfolio is coming soon.",
      );
    await page.getByLabel("Maple community", { exact: true }).check();
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await page.waitForURL(/\/app\/posts\/[a-f0-9-]+$/);
    await page.getByRole("link", { name: "Edit post", exact: true }).click();
    const when = new Date(Date.now() + 86400000 * 2);
    await page
      .getByLabel("Date and time", { exact: false })
      .fill(inZone(when, brand.timezone));
    await page.route(
      "https://images.example.org/appshell.svg",
      (route: { fulfill: (o: object) => Promise<void> }) =>
        route.fulfill({
          contentType: "image/svg+xml",
          body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><rect width="600" height="600" fill="#ecfdf5"/><circle cx="300" cy="270" r="150" fill="#047857"/><text x="300" y="500" text-anchor="middle" font-size="42" fill="#065f46">Maple Studio</text></svg>',
        }),
    );
    await page.getByText("Add image by URL",{exact:true}).click();
    await page.getByLabel("Public HTTPS image URL").fill("https://images.example.org/appshell.svg");
    await page.getByRole("button",{name:"Add image",exact:true}).click();
    await page.waitForFunction(() => {
      const img = document.querySelector(
        'img[alt="Media preview 1"]',
      ) as HTMLImageElement;
      return img?.complete && img.naturalWidth > 0;
    });
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      await page.evaluate(() =>
        window.scrollTo({ top: 0, behavior: "instant" }),
      );
      await page.screenshot({
        path: `${evidence}/composer-${width}.png`,
        fullPage: true,
      });
    }
    await page.getByRole("button",{name:"Remove image 1",exact:true}).click();
    await page.getByRole("button", { name: "Schedule", exact: true }).click();
    await page.waitForURL(/\/app\/posts\/[a-f0-9-]+$/);
    await page
      .getByRole("status")
      .filter({ hasText: "Post scheduled for" })
      .waitFor();
    const [post] = await db
      .select()
      .from(posts)
      .where(eq(posts.brandId, brand.id));
    assert.equal(post.status, "scheduled");
    stage = "responsive route evidence";
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      for (const [name, path] of [
        ["overview", "/app"],
        ["brand", "/app/brands/" + brand.id],
        ["calendar", "/app/calendar"],
      ]) {
        await page.goto(base + path);
        await page.locator("h1").waitFor();
        assert.equal(
          await page.locator(".app-new-post-desktop").isVisible(),
          width >= 768,
        );
        assert.equal(await page.locator(".app-fab").isVisible(), width < 768);
        const primaryLink = page.locator(
          width < 768 ? ".app-fab" : ".app-new-post-desktop",
        );
        assert.equal(
          await primaryLink.evaluate(
            (el: HTMLElement) => getComputedStyle(el).color,
          ),
          "rgb(255, 255, 255)",
        );
        assert(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          name + " overflow",
        );
        if (name === "overview") {
          assert.equal(await page.getByRole("list", { name: "Getting started" }).count(), 0);
          assert(
            await page
              .getByRole("link", { name: post.body, exact: true })
              .isVisible(),
          );
        }
        if (name === "calendar")
          assert(
            (await page.locator("main").innerText()).includes("A fresh look"),
          );
        await page.evaluate(() =>
          window.scrollTo({ top: 0, behavior: "instant" }),
        );
        await page.screenshot({
          path: `${evidence}/${name}-${width}.png`,
          fullPage: true,
        });
      }
    }
    stage = "attention and completion";
    await db
      .update(channels)
      .set({ status: "token_expired" })
      .where(eq(channels.id, channel.id));
    await db
      .update(postTargets)
      .set({ status: "needs_review" })
      .where(eq(postTargets.postId, post.id));
    await page.goto(base + "/app");
    await page
      .getByRole("link", { name: "Reconnect channel", exact: true })
      .waitFor();
    await page
      .getByText("We couldn’t confirm delivery.", { exact: false })
      .waitFor();
    await db
      .update(channels)
      .set({ status: "active" })
      .where(eq(channels.id, channel.id));
    await db
      .update(postTargets)
      .set({ status: "queued" })
      .where(eq(postTargets.postId, post.id));
    await page.goto(base + "/app/posts/new?brand=" + brand.id);
    await page
      .getByLabel("Post text", { exact: true })
      .fill("Please review our next campaign.");
    await page.getByLabel("Maple community", { exact: true }).check();
    await page
      .getByLabel("Date and time", { exact: false })
      .fill(inZone(when, brand.timezone));
    await page.getByLabel("Requires client approval", { exact: true }).check();
    await page.getByRole("button", { name: "Schedule", exact: true }).click();
    await page.waitForURL(/\/app\/posts\/[a-f0-9-]+$/);
    await page.goto(base + "/app");
    assert.equal(await page.getByRole("list", { name: "Getting started" }).count(), 0);
    await page.getByRole("button", { name: "Copy link", exact: true }).click();
    await page
      .getByRole("status")
      .filter({ hasText: "Link copied." })
      .waitFor();
    await page.waitForFunction(
      () => !document.querySelector("[role=progressbar]"),
    );
    await page.reload();
    assert.equal(await page.getByRole("progressbar").count(), 0);
    stage = "404 and marketing";
    // A 404 intentionally emits a browser network error; exclude it from application console checks.
    assert.equal(errors.length, 0);
    await page.goto(base + "/app/brands/not-a-brand");
    await page
      .getByRole("heading", { name: "This page isn’t in your workspace" })
      .waitFor();
    await page.goto(base + "/app/no-such-page");
    await page.getByRole("heading", { name: "This page isn’t in your workspace" }).waitFor();
    assert.equal(await page.locator(".site-header, .site-footer").count(), 0);
    await page.goto(base + "/");
    assert.equal(await page.locator(".site-header").count(), 1);
    writeFileSync(
      evidence + "/results.json",
      JSON.stringify(
        {
          onboarding: "0/3 → hidden after brand, channel and post exist",
          invalidCredentialsPreserved: true,
          realProviderLogin: false,
          activeChannel: "synthetic DB fixture; no real publishing",
          draftAndSchedule: true,
          calendarAndNextUp: true,
          responsiveWidths: [390, 1280],
          attention: true,
          app404: true,
          marketingFrame: true,
          consoleErrorsBeforeIntentional404: 0,
          fixtureCleanup: "finally deletes test user and cascading workspace",
        },
        null,
        2,
      ),
    );
    console.log(
      "PASS: onboarding, invalid connection, draft → schedule, calendar, responsive screenshots, attention, approval completion, 404, marketing",
    );
  } catch (error) {
    console.error(
      "FAIL at stage: " + stage,
      error instanceof Error ? error.message.slice(0, 1200) : "unknown",
    );
    process.exitCode = 1;
  } finally {
    await browser.close();
    await deleteFixtureUsers(db).where(eq(users.id, uid));
    await db.$client.end();
  }
}
main().catch(() => {
  console.error("App-shell verification setup failed");
  process.exitCode = 1;
});
