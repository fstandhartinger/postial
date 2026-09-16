// Shared origin takes precedence; historical per-script variables remain supported.
if (process.env.VERIFY_BASE_URL) process.env.MARKETING_TEST_URL = process.env.VERIFY_BASE_URL;
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const origin = process.env.MARKETING_TEST_URL ?? 'http://localhost:3991';
const copy = JSON.parse(await readFile(new URL('../content/compare.json', import.meta.url), 'utf8'));
const availability = JSON.parse(await readFile(new URL('../content/availability.json', import.meta.url), 'utf8'));
const networkNames = status => availability.networks.filter(network => network.status === status).map(network => network.name).join(', ');
const liveNetworkNames = networkNames('live');
const earlyAccessNetworkNames = networkNames('preparation');
// Every placeholder token declared anywhere in the comparison copy; the scan below must find none of them rendered.
const tokens = new Set();
(function collect(value) {
  if (typeof value === 'string') { for (const match of value.matchAll(/\{([a-zA-Z]+)\}/g)) tokens.add(`{${match[1]}}`); return; }
  if (Array.isArray(value)) { value.forEach(collect); return; }
  if (value && typeof value === 'object') Object.values(value).forEach(collect);
})(copy);
assert.ok(tokens.has('{liveNetworkNames}') && tokens.has('{earlyAccessNetworkNames}'), 'compare.json no longer declares the network placeholder tokens');
for (const page of copy.pages) {
  const route = `/compare/${page.slug}`;
  const response = await fetch(new URL(route, origin));
  assert.equal(response.status, 200, route);
  const html = await response.text();
  // Visible markup only: script/style payloads may legitimately carry code and serialized data.
  const visible = html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ');
  for (const match of visible.matchAll(/\{[a-zA-Z]+\}/g)) assert.fail(`${route}: unresolved placeholder ${match[0]}`);
  for (const token of tokens) assert.ok(!visible.includes(token), `${route}: unresolved placeholder ${token}`);
  const h1 = visible.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
  assert.ok(h1, `${route}: no <h1>`);
  assert.ok(h1[1].includes(liveNetworkNames), `${route}: H1 does not carry the live network names`);
  assert.ok(visible.includes(earlyAccessNetworkNames), `${route}: early-access network names not rendered`);
  console.log(`PASS ${route}: 200, H1 hydrated, no unresolved placeholders`);
}
console.log(`PASS compare: ${copy.pages.length} routes rendered without literal placeholder tokens`);
