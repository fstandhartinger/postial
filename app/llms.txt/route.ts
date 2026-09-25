import availability from '@/content/availability.json';
import compare from '@/content/compare.json';
import solutions from '@/content/solutions.json';
import { helpIndex } from '@/app/docs/content';
import { networkSummary } from '@/components/marketing/NetworkAvailability';
import { plans, TRIAL_DAYS } from '@/lib/plans';
import { siteUrl } from '@/lib/seo';

// llms.txt (https://llmstxt.org): a plain-text map of the public site for language models.
// Built from the same content files as the pages, so it cannot drift from what they say.
export const dynamic = 'force-static';

export function GET() {
  const link = (path: string, title: string, note?: string) => `- [${title}](${new URL(path, siteUrl).href})${note ? `: ${note}` : ''}`;
  const body = [
    '# Postial',
    '',
    '> Social media scheduling with login-free client approvals for agencies. Made in Passau, Germany; application data hosted in Germany.',
    '',
    networkSummary,
    '',
    `Plans: Starter €${plans.starter.monthlyEuro}/month (${plans.starter.brands} brands, ${plans.starter.seats} user); Agency €${plans.agency.monthlyEuro}/month (${plans.agency.brands} brands, ${plans.agency.seats} users, client approval links, REST API, webhooks, n8n node). Prices include VAT. ${TRIAL_DAYS}-day trial without a card.`,
    '',
    `Available today: ${availability.available.join('; ')}.`,
    '',
    '## Product',
    link('/', 'Home'),
    link('/pricing', 'Pricing'),
    link('/roadmap', 'Roadmap and network availability'),
    link('/docs/api', 'REST API reference'),
    link('/openapi.json', 'OpenAPI specification'),
    '',
    '## Guides',
    ...solutions.pages.map(page => link(`/${page.slug}`, page.name, page.description)),
    '',
    '## Help center',
    ...helpIndex.map(article => link(`/docs/${article.slug}`, article.title, article.summary.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1'))),
    '',
    '## Comparisons',
    ...compare.pages.map(page => link(`/compare/${page.slug}`, `Postial vs ${page.vendor}`)),
    '',
    '## Company',
    link('/impressum', 'Impressum (legal notice)'),
    link('/privacy', 'Privacy policy'),
    link('/terms', 'Terms of service'),
    link('/legal/dpa', 'Data processing agreement'),
    '',
  ].join('\n');
  return new Response(body, { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600' } });
}
