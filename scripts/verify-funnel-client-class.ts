import assert from 'node:assert/strict';
import test from 'node:test';
import { eq } from 'drizzle-orm';
import { getDb } from '../db';
import { funnelEvents } from '../db/schema';
import { classifyUserAgent, funnelReport, recordFunnelEvent, searchEngine } from '../lib/funnel';
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

test('admin funnel report keeps all three client classes separate', async () => {
  const path = `/verify-client-class-${crypto.randomUUID()}`;
  await recordFunnelEvent('landing_view', { path, clientClass: 'browser' });
  await recordFunnelEvent('landing_view', { path, clientClass: 'automated' });
  await recordFunnelEvent('landing_view', { path, clientClass: 'unknown' });
  const report = await funnelReport(30);
  assert.ok((report.clientClassTotals.browser.landing_view ?? 0) >= 1);
  assert.ok((report.clientClassTotals.automated.landing_view ?? 0) >= 1);
  assert.ok((report.clientClassTotals.unknown.landing_view ?? 0) >= 1);
  assert.notEqual(report.clientClassTotals.browser, report.clientClassTotals.automated);
  const admin = readFileSync('app/app/admin/funnel/page.tsx', 'utf8');
  assert.match(admin, /People \(browser\)/);
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
