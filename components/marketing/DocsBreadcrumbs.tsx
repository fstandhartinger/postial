import Link from 'next/link';
import { jsonLd, siteUrl } from '@/lib/seo';

export function DocsBreadcrumbs({ current, path = '/docs' }: { current: string; path?: string }) {
  const items = [
    { name: 'Postial Help', url: `${siteUrl}/docs` },
    { name: current, url: `${siteUrl}${path}` },
  ];
  const schema = { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: items.map((item, index) => ({ '@type': 'ListItem', position: index + 1, name: item.name, item: item.url })) };
  return <>
    <nav aria-label="Breadcrumb" className="mb-4 text-sm"><Link href="/docs">Postial Help</Link><span aria-hidden="true"> / </span><span>{current}</span></nav>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(schema) }} />
  </>;
}
