import { helpIndex } from '@/app/docs/content';
import compare from '@/content/compare.json';
import changelog from '@/content/changelog.json';
import type { MetadataRoute } from 'next';
import { siteUrl } from '@/lib/seo';
// Derived from the newest changelog entry rather than a constant. The date sat frozen at
// 2026-09-09 while content demonstrably changed afterwards, so a search engine that trusts
// lastmod had no reason to look again. The changelog is the one dated record of what
// customers can actually see.
const contentUpdated = new Date(
  (changelog as ReadonlyArray<{ date: string }>).map(entry => entry.date).sort().at(-1) ?? '2026-09-09',
);
export default function sitemap(): MetadataRoute.Sitemap {
  const paths = ['/', '/pricing', '/roadmap', '/impressum', '/privacy', '/terms', '/legal', '/legal/dpa', '/docs', '/docs/api', ...helpIndex.map(article => `/docs/${article.slug}`), '/compare', ...compare.pages.map(page => `/compare/${page.slug}`)];
  return paths.map(path => ({ url: new URL(path, siteUrl).href, lastModified: contentUpdated, changeFrequency: 'monthly', priority: path === '/' ? 1 : 0.7 }));
}
