// Shared origin takes precedence; historical per-script variables remain supported.
if (process.env.VERIFY_BASE_URL) process.env.MARKETING_TEST_URL = process.env.VERIFY_BASE_URL;
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const origin = process.env.MARKETING_TEST_URL ?? 'http://localhost:3991';
const copy = JSON.parse(await readFile(new URL('../content/landing.json', import.meta.url), 'utf8'));
// Read out of the source rather than imported: this file is .mjs and cannot load a .tsx module.
const plansSource = await readFile(new URL('../components/marketing/Plans.tsx', import.meta.url), 'utf8');
const displayName = plansSource.match(/STRIPE_ACCOUNT_DISPLAY_NAME = '([^']+)'/)?.[1];
assert.ok(displayName, 'Plans.tsx no longer declares STRIPE_ACCOUNT_DISPLAY_NAME');
for (const route of ['/', '/pricing', '/impressum', '/privacy', '/terms', '/sitemap.xml', '/robots.txt']) {
  const response = await fetch(new URL(route, origin));
  assert.equal(response.status, 200, route);
  const html = await response.text();
  assert.ok(!html.includes('CHECK'), `${route}: unresolved marker`);
  if (route === '/pricing') {
    // Verify both names in rendered copy, including HTML-escaped company punctuation.
    const text = html.replace(/<!--.*?-->/gs, '').replace(/<[^>]+>/g, ' ').replaceAll('&amp;', '&').replace(/\s+/g, ' ');
    assert.match(text, /Payment is handled by Stripe\./, '/pricing: no note on who handles payment');
    assert.ok(text.includes('The checkout heading shows Postial.'), '/pricing: missing product heading');
    assert.ok(text.includes(`Your receipt and invoice show our company account name, ${displayName}.`),
      '/pricing: the disclosed account name is not the one the code carries');
  }
  if (route === '/') {
    const headings = [...html.matchAll(/<h1[^>]*>(.*?)<\/h1>/gs)].map(match => match[1]);
    assert.deepEqual(headings, [copy.Hero.find(item => item.label === 'H1').text]);
    const text = html.replace(/<[^>]+>/g, '').replaceAll('&amp;', '&').replaceAll('&#x27;', "'").replaceAll('&quot;', '"').replaceAll('<!-- -->', '');
    for (const [section, entries] of Object.entries(copy)) {
      if (['Navigation', 'SEO', 'Networks', 'Starter card', 'Agency card', 'Shared pricing notes', 'Footer'].includes(section)) continue;
      for (const item of entries) {
        if (['Card strings and behavior', 'Tax note'].includes(item.label)) continue;
        if (section === 'FAQ' && ['Answer 4', 'Answer 7'].includes(item.label)) continue; // Rendered from live availability below.
        if (section === 'Interactive demo' && !['H2', 'Sub'].includes(item.label)) continue;
        assert.ok(text.includes(item.text), `Missing copy: ${section}: ${item.text}`);
      }
    }
    const availability = JSON.parse(await readFile(new URL('../content/availability.json', import.meta.url), 'utf8'));
    for (const item of [...availability.starter, ...availability.agency, availability.pending]) assert.ok(text.includes(item), `Missing availability: ${item}`);
    const schema = JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1]);
    assert.equal(schema['@type'], 'SoftwareApplication');
    assert.deepEqual(schema.offers.map(offer => [offer.name, offer.price, offer.priceCurrency]), [['Starter', '19', 'EUR'], ['Agency', '49', 'EUR']]);
  }
  if (route === '/impressum') for (const value of ['productivity-boost.com Betriebs UG (haftungsbeschränkt) &amp; Co. KG', 'HRB 8453', 'DE296812612']) assert.ok(html.includes(value), value);
  if (['/privacy', '/terms'].includes(route)) assert.match(html, /(?:Last updated|Updated):?[^<]*(?:2026|September)/i);
  console.log(`PASS ${route}: 200, no unresolved markers`);
}
