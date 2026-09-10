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
    openGraph: { type: 'website', siteName: 'Postial', title, description, url },
    twitter: { card: 'summary', title, description },
    ...(robots ? { robots } : { robots: { index: true, follow: true } }),
  };
}

export function jsonLd(value: unknown) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}
