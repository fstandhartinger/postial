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

/**
 * Turns an article's opening paragraph into a meta description.
 *
 * The paragraph is body text: it may contain Markdown links, and it is written to be read on the
 * page, not inside a search result. Two things follow. Search engines print the string verbatim,
 * so "[n8n workflow guide](/docs/n8n-postial)" appeared with its brackets and path in the
 * description of /docs/n8n until 2026-09-12. And a description past roughly 160 characters is cut
 * mid-sentence in the result, which is how /docs/n8n (322) and /docs/n8n-postial (245) looked.
 *
 * The trailing sentence is boilerplate, so it is only appended when it still fits.
 */
export const SEARCH_DESCRIPTION_LIMIT = 160;
export function searchDescription(summary: string, suffix = ''): string {
  const plain = summary
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (suffix && `${plain} ${suffix}`.length <= SEARCH_DESCRIPTION_LIMIT) return `${plain} ${suffix}`;
  if (plain.length <= SEARCH_DESCRIPTION_LIMIT) return plain;
  const cut = plain.slice(0, SEARCH_DESCRIPTION_LIMIT - 1);
  const boundary = cut.lastIndexOf(' ');
  return `${cut.slice(0, boundary > 0 ? boundary : cut.length).replace(/[\s,;:.]+$/, '')}…`;
}
