// Shared origin takes precedence; historical per-script variables remain supported.
if (process.env.VERIFY_BASE_URL) process.env.APPROVAL_HTTP_URL = process.env.VERIFY_BASE_URL;
import { deleteFixtureUsers } from './fixture-cleanup';
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { subscriptions, users, workspaces, workspaceMembers, brands, channels, posts, postTargets, postEvents, approvalDecisions, sessions } from "../db/schema";
import { newApprovalToken, publicApproval, rotateApprovalLink } from "../lib/approvals";
import { publicImageAddress } from "../app/r/[token]/media";

async function main() {
  const db = getDb();
  const base = process.env.APPROVAL_HTTP_URL || "http://localhost:3995";
  const userId = crypto.randomUUID();
  const session = crypto.randomUUID();
  let browser: { close(): Promise<void> } | undefined;
  try {
    for (const address of ["127.0.0.1", "10.1.2.3", "169.254.169.254", "192.168.1.1", "100.64.0.1", "::1", "::ffff:127.0.0.1", "fd00::1", "2002:7f00:1::1"]) assert(!publicImageAddress(address), "Private/reserved image IP rejected");
    for (const address of ["8.8.8.8", "2606:4700:4700::1111"]) assert(publicImageAddress(address), "Public image IP accepted");
    await db.insert(users).values({ id: userId, name: "Approval fixture" });
    const [workspace] = await db.insert(workspaces).values({ name: "Approval fixture", slug: `approval-${userId}`, ownerUserId: userId }).returning();
    await db.insert(subscriptions).values({workspaceId: workspace.id, plan: "agency", status: "active", stripeSubscriptionId: "fixture-approvals-" + userId, currentPeriodEnd: new Date(Date.now() + 86400000)});
    await db.insert(workspaceMembers).values({ workspaceId: workspace.id, userId, role: "owner" });
    await db.insert(sessions).values({ sessionToken: session, userId, expires: new Date(Date.now() + 600000) });
    const [brand] = await db.insert(brands).values({ workspaceId: workspace.id, name: "Mint Studio", slug: "mint", color: "#7c3aed", timezone: "Europe/Berlin" }).returning();
    const [channel] = await db.insert(channels).values({ brandId: brand.id, provider: "mastodon", displayName: "Mint feed", externalId: "synthetic-approval", credentialsEnc: "never-publish-fixture" }).returning();
    const token = newApprovalToken();
    const scheduledAt = new Date(Date.now() + 86400000);
    const [post] = await db.insert(posts).values({ brandId: brand.id, authorUserId: userId, body: 'Approval test <script>alert("unsafe")</script>', mediaUrls: ["https://example.test/post.png"], linkUrl: "https://example.test/story", scheduledAt, requiresApproval: true, approvalToken: token, status: "pending_approval" }).returning();
    await db.insert(postTargets).values({ postId: post.id, channelId: channel.id });
    assert.equal(Buffer.from(post.approvalToken!, "base64url").length, 32);
    assert.equal(post.status, "pending_approval");
    const path = `/r/${token}`;
    await db.update(posts).set({ mediaUrls: ["https://127.0.0.1/private"] }).where(eq(posts.id, post.id));
    assert.equal((await fetch(`${base}${path}?media=0`)).status, 404);
    assert.equal((await fetch(`${base}${path}?media=7`)).status, 404);
    await db.update(posts).set({ mediaUrls: post.mediaUrls }).where(eq(posts.id, post.id));
    const get = () => fetch(base + path);
    let approvalVersion = (await publicApproval(token))!.approvalVersion;
    const submit = (decision: string, comment = "", currentToken = token, origin = base, version = approvalVersion) => fetch(`${base}/r/${currentToken}`, {
      method: "POST", headers: { Origin: origin, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ reviewerName: "Anna", decision, comment, approvalVersion: version }),
    });
    let response = await get();
    assert.equal(response.status, 200);
    assert.match(response.headers.get("x-robots-tag")!, /noindex/);
    let html = await response.text();
    assert(html.includes("Approval test &lt;script&gt;"));
    assert(html.includes('name="referrer" content="same-origin"'));
    assert(html.includes("Mastodon"));
    assert(html.includes("Europe/Berlin"));
    for (const privateValue of [userId, workspace.id, post.id, brand.id, channel.id, "credentialsEnc", token]) assert(!html.includes(privateValue), "No internal data or token outside path");
    const staleVersion = approvalVersion;
    await db.update(posts).set({ body: "Approval test revised after the client opened the page." }).where(eq(posts.id, post.id));
    response = await submit("approved", "", token, base, staleVersion);
    assert.equal(response.status, 409);
    assert((await response.text()).includes("This post was changed while you were reviewing it. Please reload the page and review the new version."));
    assert.equal((await db.select({ status: posts.status }).from(posts).where(eq(posts.id, post.id)))[0].status, "pending_approval");
    assert((await (await get()).text()).includes("Approval test revised after the client opened the page."));
    approvalVersion = (await publicApproval(token))!.approvalVersion;
    assert.equal((await fetch(base + "/r/falsch")).status, 404);
    assert.equal((await fetch(base + "/r/" + newApprovalToken())).status, 404);
    assert.equal((await submit("approved", "", token, "https://evil.test")).status, 403);
    response = await submit("changes_requested");
    assert.equal(response.status, 400);
    assert((await response.text()).includes("Please describe the changes"));
    response = await submit("changes_requested", "Please shorten the opening.");
    assert.equal(response.status, 200);
    let [updated] = await db.select().from(posts).where(eq(posts.id, post.id));
    assert.equal(updated.status, "changes_requested");
    assert.equal(updated.approvalNote, "Please shorten the opening.");
    const events = await db.select().from(postEvents).where(eq(postEvents.postId, post.id));
    assert(events.some((e) => e.message === "Client Anna requested changes: Please shorten the opening."));
    response = await submit("approved");
    assert.equal(response.status, 200);
    [updated] = await db.select().from(posts).where(eq(posts.id, post.id));
    assert.equal(updated.status, "approved");
    const [target] = await db.select().from(postTargets).where(eq(postTargets.postId, post.id));
    assert.equal(target.status, "queued");
    assert.equal(target.nextAttemptAt?.getTime(), scheduledAt.getTime());
    html = await (await get()).text();
    assert(html.includes("Approved by Anna on"));
    assert.equal((await submit("changes_requested", "Hold this please.")).status, 200);
    const [held] = await db.select().from(postTargets).where(eq(postTargets.postId, post.id));
    assert.equal(held.nextAttemptAt, null);
    const decisions = await db.select().from(approvalDecisions).where(eq(approvalDecisions.postId, post.id));
    assert.equal(decisions.length, 3);
    assert(decisions.every((d) => /^[a-f0-9]{64}$/.test(d.reviewerIpHash)));
    assert.equal(await rotateApprovalLink(post.id, crypto.randomUUID()), false);
    assert(await rotateApprovalLink(post.id, workspace.id));
    [updated] = await db.select().from(posts).where(eq(posts.id, post.id));
    const fresh = updated.approvalToken!;
    assert.notEqual(fresh, token);
    assert.equal((await get()).status, 404);
    assert.equal((await submit("approved")).status, 404);
    assert.equal((await fetch(`${base}/r/${fresh}`)).status, 200);
    const results = await Promise.all(Array.from({ length: 11 }, () => submit("approved", "", fresh)));
    assert.equal(results.filter((r) => r.status === 200).length, 10);
    assert.equal(results.filter((r) => r.status === 429).length, 1);
    assert.equal(results.find((r) => r.status === 429)?.headers.get("retry-after"), "3600");
    console.log("PASS: HTTP, CSRF, validation, decision history, worker queue/hold, rotation, concurrent 10/hour limit");

    // Browser is optional only when explicitly running the HTTP subset. The full
    // milestone check requires PLAYWRIGHT_MODULE pointing to installed Playwright.
    if (process.env.PLAYWRIGHT_MODULE) {
      const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
      const running = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome", args: ["--no-sandbox"] });
      browser = running;
      const context = await running.newContext({ viewport: { width: 390, height: 844 } });
      const page = await context.newPage();
      await page.route("**/r/*?media=0", (route: { fulfill(options: object): Promise<void> }) => route.fulfill({ status: 200, contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="300"><rect width="600" height="300" fill="#7c3aed"/></svg>' }));
      await rotateApprovalLink(post.id, workspace.id);
      [updated] = await db.select().from(posts).where(eq(posts.id, post.id));
      await page.goto(`${base}/r/${updated.approvalToken}`);
      assert.equal(await page.locator("img").evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0), true);
      await page.getByLabel("Name (required)").focus();
      await page.keyboard.type("Keyboard reviewer");
      await page.keyboard.press("Tab");
      assert.equal(await page.locator(":focus").getAttribute("name"), "comment");
      await page.keyboard.type("Please update the final line.");
      await page.keyboard.press("Tab");
      assert.equal(await page.locator(":focus").getAttribute("value"), "approved");
      await page.keyboard.press("Tab");
      assert.equal(await page.locator(":focus").getAttribute("value"), "changes_requested");
      await Promise.all([page.waitForNavigation(), page.keyboard.press("Enter")]);
      assert(await page.getByText("Thank you. Your decision has been saved.").isVisible(), await page.locator("section[aria-label=\"Review decision\"]").innerText());
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
      await page.screenshot({ path: process.env.APPROVAL_SCREENSHOT || "/tmp/postial-approvals-mobile.png", fullPage: true });

      // Synthetic DB session only: no real account/provider login is automated.
      await context.addCookies([{ name: "authjs.session-token", value: session, url: base }]);
      await page.goto(`${base}/app/posts/new`);
      await page.getByLabel("Post text").fill("Created through the real composer");
      await page.getByLabel("Mint feed", { exact: true }).check();
      await page.getByLabel("Date and time").fill("2030-01-15T12:00");
      await page.getByLabel("Requires client approval").check();
      await page.getByRole("button", { name: "Schedule", exact: true }).click();
      await page.getByLabel("Client approval link").waitFor();
      const created = await db.select().from(posts).where(eq(posts.brandId, brand.id));
      const composerPost = created.find((p) => p.body === "Created through the real composer")!;
      assert.equal(composerPost.status, "pending_approval");
      assert.equal(Buffer.from(composerPost.approvalToken!, "base64url").length, 32);
      assert.equal((await fetch(await page.getByLabel("Client approval link").inputValue())).status, 200);
      console.log("PASS: real composer creates pending post and displays a working 32-byte approval link");
      await page.goto(`${base}/app/posts/${post.id}`);
      const linkBefore = await page.getByLabel("Client approval link").inputValue();
      await page.getByRole("button", { name: "Regenerate link" }).click();
      await page.waitForFunction((previous: string) => Array.from(document.querySelectorAll("input")).some((i) => i.readOnly && i.value.includes("/r/") && i.value !== previous), linkBefore);
      const linkAfter = await page.getByLabel("Client approval link").inputValue();
      assert.equal((await fetch(linkBefore)).status, 404);
      assert.equal((await fetch(linkAfter)).status, 200);
      await db.update(postTargets).set({ status: "publishing", attempts: 1 }).where(eq(postTargets.postId, post.id));
      assert(!(await (await fetch(linkAfter)).text()).includes('<form'));
      assert.equal((await submit("approved", "", linkAfter.split("/").pop()!)).status, 409);
      await db.update(posts).set({ status: "published" }).where(eq(posts.id, post.id));
      const readOnly = await fetch(linkAfter);
      html = await readOnly.text();
      assert(!html.includes('<form'));
      assert.equal((await submit("approved", "", linkAfter.split("/").pop()!)).status, 409);
      console.log("PASS: 390px screenshot, media, keyboard submission, real agency rotation action, published read-only");
    } else {
      console.log("OPEN: browser checks require PLAYWRIGHT_MODULE");
    }
  } finally {
    await browser?.close();
    await deleteFixtureUsers(db).where(eq(users.id, userId));
    await db.$client.end();
  }
}
main().catch((error) => { console.error(error instanceof assert.AssertionError ? error.message : "Approval verification failed (details withheld)"); process.exitCode = 1; });
