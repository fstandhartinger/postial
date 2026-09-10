import { helpIndex } from '@/app/docs/content';
import compare from '@/content/compare.json';
import type { MetadataRoute } from 'next';
import { siteUrl } from '@/lib/seo';
export default function sitemap(): MetadataRoute.Sitemap {
  const paths = ['/', '/pricing', '/roadmap', '/impressum', '/privacy', '/terms', '/legal', '/legal/dpa', '/docs', '/docs/api', ...helpIndex.map(article => `/docs/${article.slug}`), '/compare', ...compare.pages.map(page => `/compare/${page.slug}`)];
  return paths.map(path => ({ url: new URL(path, siteUrl).href, lastModified: new Date('2026-09-09'), changeFrequency: 'monthly', priority: path === '/' ? 1 : 0.7 }));
}
