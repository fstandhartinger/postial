import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import index from '../content/help/index.json';
import { HelpMarkdown, safeHelpHref } from '../app/docs/_components/markdown';

async function main() {
const base = process.env.DOCS_HTTP_URL || 'http://localhost:4018';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'Verifier is local-only');
for (const [file, slug] of [['posts/new', 'first-post'], ['posts/[id]/edit', 'first-post'], ['channels', 'channels'], ['approvals', 'approvals'], ['settings/team', 'team'], ['billing', 'billing']]) {
  const page = readFileSync(`app/app/${file}/page.tsx`, 'utf8');
  assert.ok(page.includes(`href="/docs/${slug}" target="_blank" rel="noopener noreferrer"`), `Missing safe new-tab help link: ${file}`);
}
const expected = ['/docs', '/docs/api', '/privacy', '/terms', '/legal/dpa', ...index.map(article => `/docs/${article.slug}`)];
const seen = new Map<string, string>();
const pending = new Set(expected);
const fragments: { target: string; hash: string }[] = [];
assert.ok(Buffer.byteLength(JSON.stringify(index)) < 65536, 'Search index must stay below 64 KiB');
assert.equal(new Set(index.map(article => article.slug)).size, index.length);
assert.equal(readdirSync('content/help').filter(file => file.endsWith('.md')).length, index.length);
for (const article of index) {
  const source = readFileSync(`content/help/${article.slug}.md`, 'utf8');
  const [heading, summary] = source.trim().split(/\n\s*\n/);
  assert.equal(heading, `# ${article.title}`);
  assert.equal(summary, article.summary);
  assert.equal(article.keywords, source.split('## Related')[0], 'Regenerate stale index with npx tsx scripts/generate-help-index.ts');
  assert.match(source, /## Steps/);
  assert.match(source, /## Related\n\n- \[/);
  assert.doesNotMatch(source, /<\/?[a-z][^>]*>|<!--|\[CHECK\]/i, 'No raw HTML or placeholders in help Markdown');
  for (const link of source.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) assert.ok(safeHelpHref(link[1]), `Unsafe Markdown link in ${article.slug}`);
}
for (const href of ['javascript:alert(1)', 'data:text/html,x', '//evil.test', '/\\evil.test', '/\nevil.test']) assert.equal(safeHelpHref(href), false);
const rendered = renderToStaticMarkup(React.createElement(HelpMarkdown, { source: '# Safety\n\n<script>alert(1)</script>\n\n[unsafe](javascript:evil)\n\n[safe](/docs)\n\n```html\n<img src=x onerror=evil>\n```' }));
assert.doesNotMatch(rendered, /<script|<img|href="javascript:/);
assert.match(rendered, /&lt;script&gt;/);
assert.match(rendered, /href="\/docs"/);
while (pending.size) {
  const route = pending.values().next().value!;
  pending.delete(route);
  if (seen.has(route)) continue;
  const response = await fetch(base + route, { signal: AbortSignal.timeout(15000) });
  assert.equal(response.status, 200, `${route} HTTP ${response.status}`);
  const html = await response.text();
  seen.set(route, html);
  if (expected.includes(route)) {
    assert.match(html, /<title>[^<]+<\/title>/, `Missing title: ${route}`);
    assert.match(html, /rel="canonical"/, `Missing canonical: ${route}`);
  }
  if (!(route === '/docs' || route.startsWith('/docs/') || ['/privacy', '/terms', '/legal/dpa'].includes(route))) continue;
  // Parse anchors only, excluding Next's serialized script payloads.
  const markup = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
  for (const match of markup.matchAll(/<a\b[^>]*\bhref="([^"]+)"/g)) {
    const url = new URL(match[1].replaceAll('&amp;', '&'), base + route);
    if (url.origin !== new URL(base).origin) continue;
    const target = url.pathname + url.search;
    if (url.hash && !url.pathname.startsWith('/app')) fragments.push({ target, hash: decodeURIComponent(url.hash.slice(1)) });
    if (!seen.has(target)) pending.add(target);
  }
}
for (const { target, hash } of fragments) assert.ok(seen.get(target)?.includes(`id="${hash}"`), `Missing fragment ${target}#${hash}`);
const sitemap = await (await fetch(base + '/sitemap.xml')).text();
for (const route of expected.filter(route => route.startsWith('/docs') || route === '/legal/dpa')) assert.ok(sitemap.includes(`${route}</loc>`), `Missing sitemap entry ${route}`);
assert.equal((await fetch(base + '/docs/not-a-real-article')).status, 404);
for (const slug of ['billing', 'approvals', 'bulk-csv', 'publishing-reliability']) assert.ok(seen.get('/docs')?.includes(`/docs/${slug}`));
console.log(`PASS: ${expected.length} documentation/legal pages, ${seen.size} local link targets, fragments, metadata, sitemap, 19-entry search index and Markdown XSS regression.`);

}
main().catch(error => { console.error(error instanceof Error ? error.message : "Docs verification failed"); process.exitCode = 1; });
