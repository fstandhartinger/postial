import type { Metadata } from 'next';

export const siteUrl = 'https://postial.co';

export function seoMetadata({
  title,
  description,
  path,
  robots,
}: {
  title: string;
  description: string;
  path: string;
  robots?: Metadata['robots'];
}): Metadata {
  const url = new URL(path, siteUrl).href;
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: url },
    openGraph: {
      type: 'website',
      siteName: 'Postial',
      title,
      description,
      url,
      images: [{ url: '/opengraph-image', width: 1200, height: 630, alt: 'Postial — scheduling and client approvals for social agencies' }],
    },
    twitter: { card: 'summary', title, description },
    ...(robots ? { robots } : { robots: { index: true, follow: true } }),
  };
}

export function jsonLd(value: unknown) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}
