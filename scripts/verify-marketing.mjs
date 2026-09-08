import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const origin = process.env.MARKETING_TEST_URL ?? 'http://localhost:3991';
const copy = JSON.parse(await readFile(new URL('../content/landing.json', import.meta.url), 'utf8'));
for (const route of ['/', '/pricing', '/impressum', '/privacy', '/terms', '/sitemap.xml', '/robots.txt']) {
  const response = await fetch(new URL(route, origin));
  assert.equal(response.status, 200, route);
  const html = await response.text();
  assert.ok(!html.includes('CHECK'), `${route}: unresolved marker`);
  if (route === '/') {
    const headings = [...html.matchAll(/<h1[^>]*>(.*?)<\/h1>/gs)].map(match => match[1]);
    assert.deepEqual(headings, ['More brands. Fewer approval chases.']);
    const text = html.replace(/<[^>]+>/g, '').replaceAll('&amp;', '&').replaceAll('&#x27;', "'").replaceAll('&quot;', '"').replaceAll('<!-- -->', '');
    for (const [section, entries] of Object.entries(copy)) {
      if (['Navigation', 'SEO'].includes(section)) continue;
      for (const item of entries) {
        if (['Card strings and behavior', 'Tax note'].includes(item.label)) continue;
        assert.ok(text.includes(item.text), `Missing copy: ${section}: ${item.text}`);
      }
    }
    const schema = JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1]);
    assert.equal(schema['@type'], 'SoftwareApplication');
    assert.deepEqual(schema.offers.map(offer => [offer.name, offer.price, offer.priceCurrency]), [['Starter', '19', 'EUR'], ['Agency', '49', 'EUR']]);
  }
  if (route === '/impressum') for (const value of ['productivity-boost.com Betriebs UG (haftungsbeschränkt) &amp; Co. KG', 'HRB 8453', 'DE296812612']) assert.ok(html.includes(value), value);
  if (['/privacy', '/terms'].includes(route)) assert.ok(html.includes('Last updated: September 8, 2026'));
  console.log(`PASS ${route}: 200, no unresolved markers`);
}
