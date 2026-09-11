import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { plans } from '../lib/plans';

const read = (file: string) => readFileSync(file, 'utf8');
const blueskyGuide = read('content/help/connect-bluesky.md');
const mastodonGuide = read('content/help/connect-mastodon.md');
const brandsGuide = read('content/help/brands.md');
const calendarGuide = read('content/help/calendar.md');
const billingGuide = read('content/help/billing.md');
const brandPage = read('app/app/brands/[id]/page.tsx');
const calendarPage = read('app/app/calendar/page.tsx');
const postPage = read('app/app/posts/[id]/page.tsx');
const billingPage = read('app/app/billing/page.tsx');
const blueskyAdapter = read('lib/publishers/bluesky.ts');
const mastodonAdapter = read('lib/publishers/mastodon.ts');

// Provider limits and credentials named by the guides must remain tied to the adapters.
assert.match(blueskyAdapter, /provider: 'bluesky', maxMediaBytes: 1000000, maxTextLength: 300/);
assert.match(blueskyAdapter, /key: 'identifier', label: 'Handle or email'/);
assert.match(blueskyAdapter, /key: 'appPassword', label: 'App password'/);
assert.match(mastodonAdapter, /provider: 'mastodon', maxMediaBytes: 16000000, maxTextLength: 500/);
assert.match(mastodonAdapter, /key: 'instanceUrl', label: 'Instance URL'/);
assert.match(mastodonAdapter, /key: 'accessToken', label: 'Access token'/);
assert.match(blueskyGuide, /300 graphemes, including any attached link/);
assert.match(blueskyGuide, /up to four images, each no larger than 1 MB/);
assert.match(mastodonGuide, /default is 500/);
assert.match(mastodonGuide, /up to four images, each no larger than 1 MB/);
assert.match(brandPage, /Connect a channel/);
assert.match(brandPage, /Preferences → Development → New\s+application/);
assert.match(brandPage, /Settings → App Passwords/);

// Plan figures in the guides are the product entitlements, not copied marketing values.
const numberWords = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen'];
assert.match(brandsGuide, new RegExp(`Starter allows ${numberWords[plans.starter.brands]} brands; Agency allows ${numberWords[plans.agency.brands]}`));
assert.match(billingGuide, new RegExp(`Starter costs €${plans.starter.monthlyEuro} per month for ${numberWords[plans.starter.brands]} brands and ${numberWords[plans.starter.seats]} seat`));
assert.match(billingGuide, new RegExp(`Agency costs €${plans.agency.monthlyEuro} per month for ${numberWords[plans.agency.brands]} brands and ${numberWords[plans.agency.seats]} seats`));
assert.match(billingGuide, /14-day trial/);
assert.match(brandsGuide, /oldest brands within the limit stay editable and extra brands become read-only/);

// Calendar instructions are the labels and state guards actually rendered by the app.
assert.match(calendarPage, /Plan several posts/);
assert.match(postPage, /\["scheduled","approved"\]/);
assert.match(postPage, /Changing only the date preserves client approval/);
assert.match(calendarGuide, /Use Reschedule on an unstarted scheduled or approved post/);
assert.match(calendarGuide, /Use Plan several posts/);
assert.match(billingPage, /Start 14-day free trial/);
assert.match(billingPage, /Manage payment method, plan and cancellation/);
assert.match(billingPage, /View invoice history/);

console.log('PASS docs-truth: five guides, provider adapters, plan limits, rendered labels and state guards');

// The Mastodon guide must keep warning about instance rules on automated posting.
// Our own test account on a general-purpose instance was suspended two days after it
// started posting unattended, which ends publishing for good; a customer must be told
// to settle this before connecting.
const mastodonGuideText = JSON.parse(readFileSync('content/help/index.json', 'utf8'))
  .find((article: { slug: string }) => article.slug === 'connect-mastodon').keywords as string;
assert.match(mastodonGuideText, /rules on automated posting/);
assert.match(mastodonGuideText, /This is an automated account/);
console.log('PASS docs truth: Mastodon guide warns about instance automation rules');

// Every customer-facing claim about the published n8n package must state one and the same
// version. On 2026-09-11 the landing page, the comparisons and the help article still said
// 0.1.2 while npm already served 0.1.3, so a prospect checking npm would have found our
// pages stale. availability.json is the single source; the changelog keeps history and is
// deliberately excluded.
{
  const versionOf = (text: string) => {
    const found = [...text.matchAll(/n8n-nodes-socialmint[`\s]*,?\s*(?:version\s*`?)?(\d+\.\d+\.\d+)/g)].map(m => m[1]);
    return [...new Set(found)];
  };
  const manifest = versionOf(readFileSync('content/availability.json', 'utf8'));
  assert.equal(manifest.length, 1, `availability.json must state exactly one package version, found ${manifest.join(', ') || 'none'}`);
  for (const file of ['content/landing.json', 'content/compare.json', 'content/help/n8n-postial.md', 'content/help/index.json']) {
    const stated = versionOf(readFileSync(file, 'utf8'));
    for (const version of stated) {
      assert.equal(version, manifest[0], `${file} claims n8n package ${version} but availability.json says ${manifest[0]}`);
    }
  }
  console.log(`PASS docs truth: every page states n8n package ${manifest[0]}`);
}

// The published n8n node (0.1.3) sends exactly these wire field names when creating a post.
// It is installed in other people's n8n instances and cannot be updated by us, so renaming
// one of these in the API would break every installation silently. Verified against the
// published tarball on 2026-09-11: the node maps its camelCase inputs to these keys.
{
  const spec = JSON.parse(readFileSync('public/openapi.json', 'utf8'));
  const create = spec.paths?.['/posts']?.post;
  const schemaRef = create?.requestBody?.content?.['application/json']?.schema;
  const schema = schemaRef?.$ref
    ? spec.components.schemas[String(schemaRef.$ref).split('/').pop()!]
    : schemaRef;
  const properties = Object.keys(schema?.properties ?? {});
  for (const field of ['brand_id', 'body', 'channel_ids', 'media_urls', 'link_url', 'requires_approval', 'scheduled_at']) {
    assert.ok(properties.includes(field), `the published n8n node sends ${field}; POST /posts must keep accepting it`);
  }
  assert.deepEqual(schema?.required, ['brand_id', 'body'], 'the node only guarantees brand_id and body; requiring more would break it');
  console.log('PASS docs truth: POST /posts still accepts every field the published n8n node sends');
}

// Mastodon returns a bot flag on verify_credentials. Our own test account was suspended two
// days after it began posting unattended without that flag, which ends publishing for that
// account permanently. Warn at the moment of connecting, and only when Mastodon says the
// account is explicitly not automated: a loose truthy check would also nag for accounts
// whose state we simply do not know.
{
  const adapter = readFileSync('lib/publishers/mastodon.ts', 'utf8');
  assert.match(adapter, /bot\?: boolean/, 'the Mastodon adapter reads the bot flag');
  assert.match(adapter, /automated: account\.bot === true/, 'the flag is mapped strictly');
  const channelsPage = readFileSync('app/app/channels/page.tsx', 'utf8');
  assert.match(channelsPage, /c\.meta\?\.automated===false/, 'the warning shows only for an explicitly non-automated account');
  assert.match(channelsPage, /This is an automated account/, 'the warning names the setting the person has to change');
  console.log('PASS docs truth: Mastodon channels warn when the account is not marked automated');
}

// The landing page fires a client-side beacon so we can tell a person from a crawler that
// sends a browser user agent. Server-side counts cannot make that distinction, and five
// cycles of conversion questions stalled on it. Nothing beyond the coarse class is stored.
{
  const beacon = readFileSync('components/marketing/ClientBeacon.tsx', 'utf8');
  assert.match(beacon, /'use client'/, 'the beacon has to run in the browser');
  assert.match(beacon, /\/api\/internal\/client-ready/, 'the beacon calls its route');
  const route = readFileSync('app/api/internal/client-ready/route.ts', 'utf8');
  assert.match(route, /classifyUserAgent/, 'the route classifies the same way a page view does');
  assert.doesNotMatch(route, /user-agent['"]\s*\)\s*[,;]\s*$/m, 'the raw user agent is never stored');
  for (const page of ['app/page.tsx', 'app/pricing/page.tsx', 'app/compare/page.tsx', 'app/compare/[slug]/page.tsx',
                      'app/docs/api/page.tsx', 'app/docs/(help)/page.tsx', 'app/docs/(help)/[slug]/page.tsx']) {
    assert.match(readFileSync(page, 'utf8'), /<ClientBeacon path=/, `${page} renders the beacon`);
  }
  // Source alone proves nothing about rendering: scripts/verify-marketing-browser.mjs asserts
  // that the request actually leaves the browser, and that pages without a beacon send none.
  console.log('PASS docs truth: the landing page measures whether a browser engine ran');
}
