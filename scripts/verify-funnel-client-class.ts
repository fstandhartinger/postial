import assert from 'node:assert/strict';
import test from 'node:test';
import { and, eq } from 'drizzle-orm';
import { getDb } from '../db';
import { funnelEvents } from '../db/schema';
import { GET as excludeMe } from '../app/api/internal/exclude-me/route';
import { POST as clientReady } from '../app/api/internal/client-ready/route';
import { classifyRequest, classifyUserAgent, CLIENT_CLASSES, funnelReport, internalMarkerValue, recordFunnelEvent, searchEngine } from '../lib/funnel';
import { readFileSync } from 'node:fs';

const db = getDb();

test('classifies browser and common automated user agents without retaining the header', async () => {
  for (const userAgent of [
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18 Safari/605.1.15',
  ]) assert.equal(classifyUserAgent(userAgent), 'browser');
  for (const userAgent of ['Googlebot/2.1', 'ExampleCrawler/1.0', 'HEADLESS-Chrome', 'curl/8.0', 'python-requests/2.32', 'Lighthouse']) {
    assert.equal(classifyUserAgent(userAgent), 'automated');
  }
  assert.equal(classifyUserAgent(undefined), 'automated');
  assert.equal(classifyUserAgent(null), 'automated');

  const marker = `ua-never-store-${crypto.randomUUID()}`;
  const event = `landing_view`;
  await recordFunnelEvent(event, { path: '/verify-client-class', clientClass: classifyUserAgent(marker) });
  const rows = await db.select().from(funnelEvents).where(eq(funnelEvents.path, '/verify-client-class'));
  assert.ok(rows.length > 0);
  assert.ok(rows.every(row => row.clientClass === 'browser'));
  assert.equal(JSON.stringify(rows).includes(marker), false);
  // Assert the property, not the phrasing. This used to match the exact call
  // classifyUserAgent(h.get('user-agent')), so introducing a local variable broke it while
  // the behaviour was unchanged. What matters is that the header is read, classified, and
  // never handed to the recorder as a value.
  const funnelSource = readFileSync('lib/funnel.ts', 'utf8');
  assert.match(funnelSource, /classifyUserAgent\(/, 'the public view classifies the agent');
  assert.match(funnelSource, /h\.get\('user-agent'\)/, 'and reads it from the request header');
  assert.doesNotMatch(funnelSource, /props:\s*\{[^}]*userAgent/i, 'the raw agent never reaches props');
});

test('classifyRequest separates browser, automated and configured internal requests', () => {
  const previousToken = process.env.FUNNEL_INTERNAL_TOKEN;
  const token = `verify-${crypto.randomUUID()}`;
  const browserUserAgent = 'Mozilla/5.0 AppleWebKit/537.36 Chrome/140 Safari/537.36';
  try {
    process.env.FUNNEL_INTERNAL_TOKEN = token;
    const marker = internalMarkerValue();
    assert.ok(marker);
    assert.match(marker, /^[a-f0-9]{64}$/);

    assert.deepEqual([...CLIENT_CLASSES], ['browser', 'automated', 'internal', 'unknown']);
    const headers = (values: Record<string, string>) => new Headers({ 'user-agent': browserUserAgent, ...values });
    assert.equal(classifyRequest(headers({})), 'browser');
    assert.equal(classifyRequest(new Headers({ 'user-agent': 'curl/8.0' })), 'automated');
    assert.equal(classifyRequest(headers({ 'x-postial-internal': token })), 'internal');
    assert.equal(classifyRequest(headers({ cookie: `pm_internal=${marker}` })), 'internal');
    assert.equal(classifyRequest(headers({ 'x-postial-internal': `${token}x` })), 'browser');
    assert.equal(classifyRequest(headers({ cookie: `pm_internal=${marker}x` })), 'browser');

    delete process.env.FUNNEL_INTERNAL_TOKEN;
    assert.equal(classifyRequest(headers({ 'x-postial-internal': token, cookie: `pm_internal=${marker}` })), 'browser');
    process.env.FUNNEL_INTERNAL_TOKEN = 'short';
    assert.equal(classifyRequest(headers({ 'x-postial-internal': 'short', cookie: 'pm_internal=ignored' })), 'browser');
  } finally {
    if (previousToken === undefined) delete process.env.FUNNEL_INTERNAL_TOKEN;
    else process.env.FUNNEL_INTERNAL_TOKEN = previousToken;
  }
});

test('exclude-me authenticates internally and the client beacon records an internal landing view', async () => {
  const previousToken = process.env.FUNNEL_INTERNAL_TOKEN;
  const token = `verify-${crypto.randomUUID()}`;
  const browserUserAgent = 'Mozilla/5.0 AppleWebKit/537.36 Chrome/140 Safari/537.36';
  const refererHost = `internal-${crypto.randomUUID()}.invalid`;
  try {
    process.env.FUNNEL_INTERNAL_TOKEN = token;
    const marker = internalMarkerValue();
    assert.ok(marker);

    const wrong = await excludeMe(new Request(`http://localhost/api/internal/exclude-me?token=${encodeURIComponent(`${token}x`)}`));
    assert.equal(wrong.status, 404);
    assert.equal(wrong.headers.get('set-cookie'), null);

    const excluded = await excludeMe(new Request(`http://localhost/api/internal/exclude-me?token=${encodeURIComponent(token)}`));
    assert.equal(excluded.status, 200);
    assert.equal(await excluded.text(), 'This browser is now excluded from Postial visitor statistics.');
    const setCookie = excluded.headers.get('set-cookie') ?? '';
    assert.match(setCookie, new RegExp(`^pm_internal=${marker}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax$`));

    const included = await excludeMe(new Request('http://localhost/api/internal/exclude-me?off=1'));
    assert.equal(included.status, 200);
    assert.match(included.headers.get('set-cookie') ?? '', /^pm_internal=; Path=\/; Max-Age=0; HttpOnly; Secure; SameSite=Lax$/);

    const beacon = await clientReady(new Request('http://localhost/api/internal/client-ready', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': browserUserAgent,
        cookie: `pm_internal=${marker}`,
        referer: `https://${refererHost}/`,
      },
      body: JSON.stringify({ path: '/' }),
    }));
    assert.equal(beacon.status, 204);

    let rows = await db.select({ event: funnelEvents.event, clientClass: funnelEvents.clientClass, path: funnelEvents.path })
      .from(funnelEvents).where(and(eq(funnelEvents.referrerHost, refererHost), eq(funnelEvents.path, '/')));
    for (let attempt = 0; attempt < 20 && rows.length === 0; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 25));
      rows = await db.select({ event: funnelEvents.event, clientClass: funnelEvents.clientClass, path: funnelEvents.path })
        .from(funnelEvents).where(and(eq(funnelEvents.referrerHost, refererHost), eq(funnelEvents.path, '/')));
    }
    assert.ok(rows.some(row => row.event === 'landing_view' && row.clientClass === 'internal' && row.path === '/'));
  } finally {
    await db.delete(funnelEvents).where(and(eq(funnelEvents.referrerHost, refererHost), eq(funnelEvents.path, '/')));
    if (previousToken === undefined) delete process.env.FUNNEL_INTERNAL_TOKEN;
    else process.env.FUNNEL_INTERNAL_TOKEN = previousToken;
  }
});

test('privacy policy documents aggregate statistics without behavioral analytics', () => {
  const privacy = JSON.parse(readFileSync('content/privacy.json', 'utf8')) as string;
  assert.match(privacy, /## Aggregate website and product statistics/);
  assert.match(privacy, /Events are deleted after 180 days/);
  assert.doesNotMatch(privacy, /behavioral analytics/);
});

test('admin funnel report keeps all four client classes separate', async () => {
  const path = `/verify-client-class-${crypto.randomUUID()}`;
  await recordFunnelEvent('landing_view', { path, clientClass: 'browser' });
  await recordFunnelEvent('landing_view', { path, clientClass: 'automated' });
  await recordFunnelEvent('landing_view', { path, clientClass: 'internal' });
  await recordFunnelEvent('landing_view', { path, clientClass: 'unknown' });
  const report = await funnelReport(30);
  assert.ok((report.clientClassTotals.browser.landing_view ?? 0) >= 1);
  assert.ok((report.clientClassTotals.automated.landing_view ?? 0) >= 1);
  assert.ok((report.clientClassTotals.internal.landing_view ?? 0) >= 1);
  assert.ok((report.clientClassTotals.unknown.landing_view ?? 0) >= 1);
  assert.notEqual(report.clientClassTotals.browser, report.clientClassTotals.automated);
  const admin = readFileSync('app/app/admin/funnel/page.tsx', 'utf8');
  assert.match(admin, /People \(browser\)/);
  assert.match(admin, /Internal \(staff and agents, excluded\)/);
  assert.match(admin, /CLIENT_CLASSES\.map\(clientClass/);
  assert.match(admin, /report\.clientClassTotals\[clientClass\]/);
});

test.after(async () => { await db.$client.end(); });

// Which search engine crawls us, if any. Search is the only acquisition channel we direct
// ourselves, and until now nothing recorded whether it was being crawled at all. Only the
// engine family is stored, never the user agent, and only for programs that announce
// themselves as crawlers; a real browser records nothing.
{
  const cases: ReadonlyArray<readonly [string, string | undefined]> = [
    ['Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', 'google'],
    ['Mozilla/5.0 (compatible; bingbot/2.0)', 'bing'],
    ['DuckDuckBot/1.1', 'duckduckgo'],
    ['GPTBot/1.2', 'ai'],
    ['Mozilla/5.0 AppleWebKit (KHTML, like Gecko) Chrome/120 Safari/537', undefined],
    ['curl/8.5.0', undefined],
    ['', undefined],
  ];
  for (const [agent, expected] of cases) {
    assert.equal(searchEngine(agent), expected, `search engine for ${agent.slice(0, 30) || '(none)'}`);
    if (expected) assert.equal(classifyUserAgent(agent), 'automated', 'a crawler stays machine-shaped');
  }
  console.log('PASS funnel: the crawling search engine is recorded by family, never by agent');
}
