import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import copy from '@/content/solutions.json';
import { ClientBeacon } from '@/components/marketing/ClientBeacon';
import { SignInNotice } from '@/components/marketing/SignInNotice';
import { jsonLd, siteUrl } from '@/lib/seo';
import { plans, TRIAL_DAYS } from '@/lib/plans';

type SolutionCopy = (typeof copy.pages)[number];
export type SolutionSlug = 'bluesky-scheduler' | 'mastodon-scheduler' | 'telegram-channel-scheduler' | 'social-media-client-approval';

function storage(bytes: number) {
  const mib = bytes / (1024 * 1024);
  return mib >= 1024 ? `${mib / 1024} GiB` : `${mib} MiB`;
}

/** Prices and allowances always come from lib/plans.ts, never from the JSON copy. */
const tokens: Record<string, string> = {
  starterPrice: `€${plans.starter.monthlyEuro}/month`,
  agencyPrice: `€${plans.agency.monthlyEuro}/month`,
  starterBrands: String(plans.starter.brands),
  agencyBrands: String(plans.agency.brands),
  starterSeats: String(plans.starter.seats),
  agencySeats: String(plans.agency.seats),
  starterStorage: storage(plans.starter.mediaBytes),
  agencyStorage: storage(plans.agency.mediaBytes),
  trialDays: String(TRIAL_DAYS),
};
function hydrate(text: string) {
  return text.replace(/\{(\w+)\}/g, (match, key: string) => tokens[key] ?? match);
}
/** Plain text for metadata and JSON-LD: tokens filled, [label](/path) reduced to its label. */
function plain(text: string) {
  return hydrate(text).replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
}
/** Renders copy with inline [label](/path) links as internal Links. */
function rich(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const source = hydrate(text);
  const pattern = /\[([^\]]+)\]\(([^)]+)\)/g;
  let last = 0;
  for (const match of source.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) parts.push(source.slice(last, index));
    parts.push(<Link prefetch={false} className="text-link" href={match[2]} key={index}>{match[1]}</Link>);
    last = index + match[0].length;
  }
  if (last < source.length) parts.push(source.slice(last));
  return parts;
}

function solution(slug: string): SolutionCopy {
  const page = copy.pages.find(candidate => candidate.slug === slug);
  if (!page) notFound();
  return page;
}

export function solutionSeo(slug: SolutionSlug) {
  const page = solution(slug);
  return { title: plain(page.title), description: plain(page.description), path: `/${page.slug}` };
}

export function SolutionPage({ slug }: { slug: SolutionSlug }) {
  const page = solution(slug);
  const path = `/${page.slug}`;
  const others = copy.pages.filter(candidate => candidate.slug !== page.slug);
  const faqSchema = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: page.faq.map(entry => ({ '@type': 'Question', name: plain(entry.question), acceptedAnswer: { '@type': 'Answer', text: plain(entry.answer) } })),
  };
  const breadcrumbSchema = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Postial', item: `${siteUrl}/` },
      { '@type': 'ListItem', position: 2, name: page.name, item: `${siteUrl}${path}` },
    ],
  };
  return <div className="solution-page">
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(faqSchema) }} />
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(breadcrumbSchema) }} />
    <ClientBeacon path={path} />
    <nav aria-label="Breadcrumb" className="note"><Link prefetch={false} className="text-link" href="/">Postial</Link> / <span aria-current="page">{page.name}</span></nav>
    <section className="hero page-hero">
      <p className="eyebrow">{page.eyebrow}</p>
      <h1>{page.h1}</h1>
      <p className="hero-sub">{rich(page.sub)}</p>
      <div className="actions"><Link prefetch={false} className="primary" href="/login">Start free — no card needed</Link><Link prefetch={false} className="secondary" href="/#demo">Try the approval demo</Link></div>
      <SignInNotice />
      <p className="note">{TRIAL_DAYS} days free, no credit card required. Starter {tokens.starterPrice}, Agency {tokens.agencyPrice}, including VAT. <Link prefetch={false} className="text-link" href="/pricing">See pricing</Link></p>
    </section>
    {page.sections.map(section => <section className="section" key={section.heading}>
      <h2>{section.heading}</h2>
      {'intro' in section && section.intro ? <p className="section-intro">{rich(section.intro)}</p> : null}
      <div className={`marketing-grid ${section.columns === 'two' ? 'two' : 'three'}`}>
        {section.cards.map(card => <article className="panel" key={card.title}><h3>{card.title}</h3><p>{rich(card.body)}</p></article>)}
      </div>
    </section>)}
    <section className="section">
      <h2>{page.stepsHeading}</h2>
      <ol className="marketing-grid three steps">{page.steps.map(step => <li key={step.title}><h3>{step.title}</h3><p>{rich(step.body)}</p></li>)}</ol>
      <p><Link prefetch={false} className="text-link" href={`/docs/${page.helpSlug}`}>{page.helpLabel} →</Link></p>
    </section>
    <section className="section">
      <h2>{page.limitsHeading}</h2>
      <ul>{page.limits.map(limit => <li key={limit}>{rich(limit)}</li>)}</ul>
      <p className="note">Networks and their conditions change. The current status of every network is on the <Link prefetch={false} className="text-link" href="/roadmap">roadmap</Link>.</p>
    </section>
    <section className="section faq-section">
      <h2>Frequently asked questions</h2>
      <div className="faq-list">{page.faq.map(entry => <details key={entry.question}><summary>{hydrate(entry.question)}</summary><p>{rich(entry.answer)}</p></details>)}</div>
    </section>
    <section className="section">
      <h2>Related guides and pages</h2>
      <div className="marketing-grid two">
        <article className="panel"><h3>Help</h3><ul>
          <li><Link prefetch={false} className="text-link" href={`/docs/${page.helpSlug}`}>{page.helpLabel}</Link></li>
          <li><Link prefetch={false} className="text-link" href="/docs/publishing-reliability">Publishing status and retries</Link></li>
          <li><Link prefetch={false} className="text-link" href="/pricing">Pricing and plans</Link></li>
          <li><Link prefetch={false} className="text-link" href="/compare">Compare Postial with other tools</Link></li>
        </ul></article>
        <article className="panel"><h3>More from Postial</h3><ul>
          {others.map(other => <li key={other.slug}><Link prefetch={false} className="text-link" href={`/${other.slug}`}>{other.linkLabel}</Link></li>)}
          <li><Link prefetch={false} className="text-link" href="/#demo">Interactive approval demo</Link></li>
        </ul></article>
      </div>
    </section>
    <section className="section final-cta">
      <h2>{page.finalHeading}</h2>
      <p>{rich(page.finalBody)}</p>
      <Link prefetch={false} className="primary" href="/login">Start free — no card needed</Link>
      <SignInNotice />
    </section>
  </div>;
}
