import type { MetadataRoute } from 'next';
import { appUrl } from '@/components/marketing/copy';
export default function robots(): MetadataRoute.Robots { return { rules: { userAgent: '*', allow: '/', disallow: ['/api/', '/app', '/login'] }, sitemap: new URL('/sitemap.xml', appUrl).href }; }
