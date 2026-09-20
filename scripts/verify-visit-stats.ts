import assert from 'node:assert/strict';
import test from 'node:test';
import { internalMarkerValue } from '../lib/funnel';
import { classifyVisitRequest, VISIT_REPORT_MIN_COUNT, VISIT_STATS_MAX_KEYS, VISIT_STATS_RETENTION_MONTHS } from '../lib/visit-stats';

const browserUserAgent = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140 Safari/537.36';

type VisitRequest = { method: string; url: string; headers: { get(name: string): string | null } };

/** HTTP-free request fixture: only the headers given here exist, everything else reads as absent. */
function visitRequest(url: string, headers: Record<string, string> = {}, method = 'GET'): VisitRequest {
  return {
    method,
    url,
    headers: { get: (name: string) => Object.prototype.hasOwnProperty.call(headers, name) ? headers[name] : null },
  };
}

test('statistic constants are the pinned retention, fold threshold and key cap', () => {
  assert.equal(VISIT_STATS_RETENTION_MONTHS, 13);
  assert.equal(VISIT_REPORT_MIN_COUNT, 3);
  assert.equal(VISIT_STATS_MAX_KEYS, 5000);
});

test('classification counts only full-page document loads from non-bot browsers', () => {
  const browserHeaders = { 'sec-fetch-dest': 'document', 'user-agent': browserUserAgent };
  assert.deepEqual(classifyVisitRequest(visitRequest('https://postial.co/', browserHeaders)), { path: '/', referrerHost: '', visit: true });
  for (const broken of [
    visitRequest('https://postial.co/', browserHeaders, 'POST'),
    visitRequest('https://postial.co/', { ...browserHeaders, 'sec-gpc': '1' }),
    visitRequest('https://postial.co/', { ...browserHeaders, dnt: '1' }),
    visitRequest('https://postial.co/', { ...browserHeaders, purpose: 'prefetch' }),
    visitRequest('https://postial.co/', { ...browserHeaders, 'sec-purpose': 'prerender; target="_blank"' }),
    visitRequest('https://postial.co/', { ...browserHeaders, 'sec-fetch-dest': 'empty', accept: 'text/html,application/xhtml+xml' }),
    visitRequest('https://postial.co/', { ...browserHeaders, 'sec-fetch-dest': 'iframe' }),
    visitRequest('https://postial.co/', { 'user-agent': browserUserAgent, accept: 'application/json' }),
    visitRequest('https://postial.co/', { ...browserHeaders, 'user-agent': '' }),
    visitRequest('https://postial.co/', { ...browserHeaders, 'user-agent': 'curl/8.0' }),
    visitRequest('https://postial.co/', { ...browserHeaders, 'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' }),
    visitRequest('https://postial.co/', { ...browserHeaders, 'user-agent': 'TelegramBot (like TwitterBot)' }),
    visitRequest('https://postial.co/', { ...browserHeaders, 'user-agent': `${browserUserAgent} Playwright` }),
  ]) {
    assert.equal(classifyVisitRequest(broken), null);
  }
  assert.deepEqual(classifyVisitRequest(visitRequest('https://postial.co/', { 'user-agent': browserUserAgent, accept: 'text/html' })), { path: '/', referrerHost: '', visit: true });
  assert.deepEqual(classifyVisitRequest(visitRequest('https://postial.co/', { ...browserHeaders, accept: 'junk' })), { path: '/', referrerHost: '', visit: true });
});

test('internal markers by token and exact cookie exclude only their own requests', () => {
  const previousToken = process.env.FUNNEL_INTERNAL_TOKEN;
  const browserHeaders = { 'sec-fetch-dest': 'document', 'user-agent': browserUserAgent };
  try {
    const token = crypto.randomUUID().replaceAll('-', '');
    process.env.FUNNEL_INTERNAL_TOKEN = token;
    const marker = internalMarkerValue();
    assert.ok(marker);
    assert.equal(classifyVisitRequest(visitRequest('https://postial.co/', { ...browserHeaders, 'x-postial-internal': token })), null);
    assert.equal(classifyVisitRequest(visitRequest('https://postial.co/', { ...browserHeaders, cookie: `other=1; pm_internal=${marker}` })), null);
    // Only the exact marker excludes: a look-alike cookie value stays a counted page load.
    assert.deepEqual(classifyVisitRequest(visitRequest('https://postial.co/', { ...browserHeaders, cookie: `other=1; pm_internal=${marker}x` })), { path: '/', referrerHost: '', visit: true });
    assert.deepEqual(classifyVisitRequest(visitRequest('https://postial.co/', { ...browserHeaders, 'x-postial-internal': `${token}x` })), { path: '/', referrerHost: '', visit: true });
    delete process.env.FUNNEL_INTERNAL_TOKEN;
    assert.deepEqual(classifyVisitRequest(visitRequest('https://postial.co/', { ...browserHeaders, 'x-postial-internal': 'anything', cookie: `pm_internal=${marker}` })), { path: '/', referrerHost: '', visit: true });
    process.env.FUNNEL_INTERNAL_TOKEN = 'short';
    assert.deepEqual(classifyVisitRequest(visitRequest('https://postial.co/', { ...browserHeaders, 'x-postial-internal': 'short' })), { path: '/', referrerHost: '', visit: true });
  } finally {
    if (previousToken === undefined) delete process.env.FUNNEL_INTERNAL_TOKEN;
    else process.env.FUNNEL_INTERNAL_TOKEN = previousToken;
  }
});

test('paths collapse to known route shapes and assets never count', () => {
  const browserHeaders = { 'sec-fetch-dest': 'document', 'user-agent': browserUserAgent };
  const path = (url: string) => classifyVisitRequest(visitRequest(url, browserHeaders))?.path ?? null;
  for (const url of [
    'https://postial.co/_next/static/x.js',
    'https://postial.co/api/healthz',
    'https://postial.co/healthz',
    'https://postial.co/icon.svg',
    'https://postial.co/font.woff2',
    'https://postial.co/docs/file.pdf',
  ]) assert.equal(path(url), null);
  assert.equal(path('https://postial.co/'), '/');
  assert.equal(path('https://postial.co///pricing///'), '/pricing');
  assert.equal(path('https://postial.co/docs/some-guide/extra'), '/docs/some-guide/extra');
  assert.equal(path('https://postial.co/docs/a/b/c'), '/docs/a/b');
  assert.equal(path('https://postial.co/totally/unknown'), '(unknown route)');
  assert.deepEqual(classifyVisitRequest(visitRequest('https://postial.co/app/calendar?q=fixture', browserHeaders)), { path: '/app/calendar', referrerHost: '', visit: true });
  assert.deepEqual(classifyVisitRequest(visitRequest('https://postial.co/m/x?a=b', browserHeaders)), { path: '/m/x', referrerHost: '', visit: true });
  assert.equal(classifyVisitRequest(visitRequest('not a url', browserHeaders)), null);
});

test('referrers reduce to the host; own and local hosts never count as arrivals', () => {
  const browserHeaders = { 'sec-fetch-dest': 'document', 'user-agent': browserUserAgent };
  const referrer = (value?: string) => classifyVisitRequest(visitRequest('https://postial.co/pricing', value === undefined ? browserHeaders : { ...browserHeaders, referer: value }));
  assert.deepEqual(referrer(), { path: '/pricing', referrerHost: '', visit: true });
  assert.deepEqual(referrer('https://www.postial.co/pricing'), { path: '/pricing', referrerHost: '', visit: false });
  assert.deepEqual(referrer('https://postial.net'), { path: '/pricing', referrerHost: '', visit: false });
  assert.deepEqual(referrer('http://localhost:3000/x'), { path: '/pricing', referrerHost: '', visit: false });
  assert.deepEqual(referrer('http://127.0.0.1:3992/pricing'), { path: '/pricing', referrerHost: '', visit: false });
  assert.deepEqual(referrer('https://www.google.com/search?q=x'), { path: '/pricing', referrerHost: 'google.com', visit: true });
  assert.deepEqual(referrer('https://news.ycombinator.com/item?id=1'), { path: '/pricing', referrerHost: 'news.ycombinator.com', visit: true });
  assert.equal(referrer('not a referrer')?.visit, true);
  assert.equal(referrer(`https://${'a'.repeat(120)}.example.test/x`)?.referrerHost?.length, 100);
});

test('the configured app host is same-site like the funnel own-host list', () => {
  const previous = process.env.APP_URL;
  const browserHeaders = { 'sec-fetch-dest': 'document', 'user-agent': browserUserAgent };
  try {
    process.env.APP_URL = 'https://fixture-app.example.test';
    assert.deepEqual(classifyVisitRequest(visitRequest('https://postial.co/docs', { ...browserHeaders, referer: 'https://fixture-app.example.test/docs' })), { path: '/docs', referrerHost: '', visit: false });
    assert.deepEqual(classifyVisitRequest(visitRequest('https://postial.co/docs', { ...browserHeaders, referer: 'https://other.example.test/docs' })), { path: '/docs', referrerHost: 'other.example.test', visit: true });
  } finally {
    if (previous === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = previous;
  }
});

test('classification never reads an IP or forwarded-IP header', () => {
  const forbidden = ['x-forwarded-for', 'x-real-ip', 'cf-connecting-ip', 'true-client-ip'];
  const known: Record<string, string> = { 'sec-fetch-dest': 'document', 'user-agent': browserUserAgent };
  const headers = {
    get: (name: string) => {
      if (forbidden.includes(name.toLowerCase())) throw new Error(`forbidden header read: ${name}`);
      return known[name] ?? null;
    },
  };
  const hit = classifyVisitRequest({ method: 'GET', url: 'https://postial.co/pricing', headers });
  assert.deepEqual(hit, { path: '/pricing', referrerHost: '', visit: true });
});

console.log('PASS visit-stats: document-load classification matrix, internal markers, route shapes and referrer hosts verified');
