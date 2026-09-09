import assert from "node:assert/strict";
const origin = process.env.VERIFY_BASE_URL || process.argv[2] || "http://localhost:3987";
for (const path of ["/healthz", "/login", "/app", "/", "/pricing", "/impressum", "/privacy", "/terms"]) {
  const response = await fetch(origin + path, { redirect: "manual" });
  assert.equal(response.status, path === "/app" ? 307 : 200, path);
  if (path === "/app") assert.equal(new URL(response.headers.get("location"), origin).pathname, "/login");
  if (path === "/healthz") { const body = await response.json(); assert.equal(body.db, true); assert.equal(body.ok, true); assert.equal(typeof body.version, "string"); }
  if (path === "/login") { const html = await response.text(); assert.ok(html.includes("Welcome to Postial")); }
  console.log(`PASS ${path}: ${response.status}`);
}
