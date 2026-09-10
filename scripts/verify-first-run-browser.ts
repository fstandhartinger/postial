import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { getDb } from "../db";
import { verificationTokens } from "../db/schema";
import { normalizeEmail } from "../lib/auth-email";
import { chromium } from "playwright";

const base = process.env.VERIFY_BASE_URL!;
const evidence = process.env.VERIFY_EVIDENCE_DIR! + "/first-run-evidence";
const email = "first-run-new-user@example.invalid";
const rawToken = "first-run-token";

async function main() {
  mkdirSync(evidence, { recursive: true });
  const db = getDb();
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome", headless: true, args: ["--no-sandbox"] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  async function capture(step: string) {
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.screenshot({ path: `${evidence}/${step}-${width}.png`, fullPage: true });
    }
    await page.setViewportSize({ width: 1280, height: 900 });
  }
  try {
    await page.goto(base + "/");
    const homeLogin = page.getByRole("link", { name: /log in|start free/i }).first();
    await homeLogin.waitFor();
    assert.equal(await homeLogin.getAttribute("href"), "/login");
    await capture("01-home");

    await homeLogin.click();
    await page.getByRole("heading", { name: "Welcome to Postial" }).waitFor();
    const emailInput = page.locator("#email");
    const send = page.getByRole("button", { name: /Send magic link/ });
    await emailInput.waitFor();
    assert(await send.isVisible() && await send.isEnabled(), "magic-link request is visible and clickable");
    await capture("02-login");

    await page.goto(base + "/login/check-email?email=" + encodeURIComponent(email));
    await page.getByRole("heading", { name: "Check your email" }).waitFor();
    assert((await page.locator("main").innerText()).includes(email), "check-email state identifies the address");
    await capture("03-check-email");

    await db.insert(verificationTokens).values({
      identifier: normalizeEmail(email),
      token: createHash("sha256").update(rawToken + process.env.AUTH_SECRET!).digest("hex"),
      expires: new Date(Date.now() + 60_000),
    });
    await page.goto(base + "/api/auth/callback/nodemailer?token=" + rawToken + "&email=" + encodeURIComponent(normalizeEmail(email)) + "&callbackUrl=" + encodeURIComponent(base + "/app"));
    await page.waitForURL(/\/app(?:$|\?)/);
    await page.getByRole("heading", { name: "Overview" }).waitFor();
    assert(await page.getByRole("link", { name: "Create brand" }).isVisible(), "first app step is visible and clickable");
    await capture("04-app");

    await page.goto(base + "/app/posts/new");
    await page.getByRole("heading", { name: "Create a post" }).waitFor();
    await page.getByRole("heading", { name: "Create a brand first" }).waitFor();
    assert(await page.getByRole("link", { name: "Create your first brand" }).isVisible(), "empty composer explains the brand prerequisite and links to it");
    await capture("04b-empty-composer");

    await page.goto(base + "/app");
    await page.getByRole("link", { name: "Create brand" }).click();
    await page.getByRole("heading", { name: "Create your first brand" }).waitFor();
    const brandName = page.getByLabel("Name");
    await brandName.fill("First-run brand");
    await page.getByRole("button", { name: "Create brand" }).click();
    await page.waitForURL(/\/app\/brands\/[0-9a-f-]+/);
    await page.getByRole("heading", { name: "Connect a channel" }).waitFor();
    assert((await page.locator("#connect").getByRole("button", { name: /Connect/ }).count()) > 0 || (await page.locator("#connect").innerText()).includes("coming soon"), "channel connection next step is explained and actionable");
    await capture("05-brand-connect");

    await page.goto(base + "/app/posts");
    await page.getByRole("heading", { name: "Posts" }).waitFor();
    await page.goto(base + "/app/posts/new");
    await page.getByRole("heading", { name: "Create a post" }).waitFor();
    const composer = page.getByRole("main");
    assert(await composer.getByRole("link", { name: "Connect a channel" }).last().isVisible(), "composer explains the channel prerequisite and links to it");
    await capture("06-first-post");
    console.log("PASS first-run journey: home → login → check email → magic link → app → brand → channel prerequisite → first post");
  } finally {
    await browser.close();
    await db.$client.end();
  }
}
main().catch((error) => { console.error("FAIL first-run journey: " + (error instanceof Error ? error.message : error)); process.exitCode = 1; });
