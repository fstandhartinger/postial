import { helpIndex } from '@/app/docs/content';
import type { MetadataRoute } from 'next';
import { appUrl } from '@/components/marketing/copy';
export default function sitemap(): MetadataRoute.Sitemap { return ['/', '/pricing', '/impressum', '/privacy', '/terms', '/legal', '/legal/dpa', '/docs', '/docs/api', ...helpIndex.map(article => `/docs/${article.slug}`), '/compare', '/compare/hootsuite-alternative', '/compare/postiz-alternative'].map(path => ({ url: new URL(path, appUrl).href, changeFrequency: 'monthly', priority: path === '/' ? 1 : 0.7 })); }
