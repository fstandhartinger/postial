import { networkSummary } from '@/components/marketing/NetworkAvailability';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { MarketingAccessStatus as AccessStatus } from '@/components/marketing/NetworkAvailability';
import { appUrl } from '@/components/marketing/copy';
import { SignInNotice } from '@/components/marketing/SignInNotice';
import copy from '@/content/compare.json';
import availability from '@/content/availability.json';
import styles from '../compare.module.css';

type Props = { params: Promise<{ slug: string }> };
export const dynamicParams = false;
export function generateStaticParams() {
  return copy.pages.map(({ slug }) => ({ slug }));
}
function comparison(slug: string) {
  const page = copy.pages.find(page => page.slug === slug);
  if (!page) notFound();
  return page;
}
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const page = comparison((await params).slug);
  const url = new URL(`/compare/${page.slug}`, appUrl).href;
  return {
    title: { absolute: `${page.title} · Postial` },
    description: page.description,
    alternates: { canonical: url },
    openGraph: { title: page.title, description: page.description, url, type: 'website', siteName: 'Postial' },
    twitter: { card: 'summary', title: page.title, description: page.description },
  };
}
export default async function ComparePage({ params }: Props) {
  const page = comparison((await params).slug);
  const networkText=networkSummary;
  const featureText=`Available today: ${availability.available.join('; ')}. ${availability.pending}. ${networkText}`;
  const faq=page.faq.map(f=>({...f,answer:/September.*rollout|rolling out|verify readiness/i.test(f.answer)?featureText:f.answer}));
  const cells=copy.postial.map((text,i)=> i===2?availability.available[2]:i===3?availability.available[3]:i===4?`${availability.available[6]}. ${availability.pending}`:i===5?networkText:text);
  const schema = {
    '@context': 'https://schema.org', '@type': 'FAQPage',
    mainEntity: faq.map(faq => ({ '@type': 'Question', name: faq.question, acceptedAnswer: { '@type': 'Answer', text: faq.answer } })),
  };
  function citations(ids: string[]) {
    return <span className={styles.citations}>{ids.map(id => {
      const index = page.sources.findIndex(source => source.id === id);
      return <a key={id} href={`#source-${id}`} aria-label={`Source ${index + 1}: ${page.sources[index].title}`}>[{index + 1}]</a>;
    })}</span>;
  }
  return <div className={styles.page}>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema).replace(/</g, '\\u003c') }} />
    <section className="hero">
      <p className="eyebrow">Postial comparisons · September 2026</p>
      <h1>{page.title}</h1>
      <p className="hero-sub">{page.intro}</p>
      <div className="actions"><Link className="primary" href="/login">Start free — no card needed</Link><Link className="secondary" href="/pricing">See pricing</Link></div>
      <SignInNotice />
      <p className="note">Starter €19/month · Agency €49/month · including VAT · 14 days free · cancel anytime</p>
      <AccessStatus />
    </section>
    <aside className="audience"><h2>Who this is for</h2><p>{page.audience}</p></aside>
    <section className="section" aria-labelledby="comparison-heading">
      <h2 id="comparison-heading">Postial and {page.vendor}, side by side</h2>
      <p className="section-intro">{copy.methodology}</p>
      <p className="note" id="table-help">On a small screen, scroll the table horizontally to read both products.</p>
      <div className={styles.tableScroll} role="region" aria-labelledby="comparison-heading" aria-describedby="table-help" tabIndex={0}>
        <table className={styles.table}>
          <caption>Published offers and documented capabilities, checked {copy.checkedAt}. Postial availability is listed above.</caption>
          <thead><tr><th scope="col">Agency requirement</th><th scope="col">Postial · early access</th><th scope="col">{page.vendor}</th></tr></thead>
          <tbody>{copy.labels.map((label, index) => <tr key={label}><th scope="row">{label}</th><td>{cells[index]}</td><td>{page.vendorCells[index].text} {citations(page.vendorCells[index].sources)}</td></tr>)}</tbody>
        </table>
      </div>
    </section>
    <section className="section"><div className="marketing-grid two">
      <article className="panel"><h2>Where Postial fits better</h2><p>{page.fits}</p></article>
      <article className="panel"><h2>Where {page.vendor} fits better</h2><p>{page.vendorFits} {citations(page.vendorFitSources)}</p></article>
    </div></section>
    <section className="section"><h2>How to switch</h2><ol className="marketing-grid three steps">{copy.switchSteps.map(step => <li key={step.title}><h3>{step.title}</h3><p>{step.body}</p></li>)}</ol></section>
    <section className="section faq-section"><h2>Frequently asked questions</h2><div className="faq-list">{faq.map(faq => <details key={faq.question}><summary>{faq.question}</summary><p>{faq.answer}</p></details>)}</div></section>
    <section className={`section ${styles.sources}`} aria-labelledby="sources-heading"><h2 id="sources-heading">Sources and pricing notes</h2><p>{copy.priceFootnote}</p><p className="note">Vendor terms can change. Hootsuite’s starting rates are taken from its pricing FAQ and annual-billing note. Postiz figures use the listed monthly cloud plans. Postial facts describe the early-access offer; this is a comparison published by Postial.</p>
      <ol>{page.sources.map((source, index) => <li id={`source-${source.id}`} key={source.id}><a className="text-link" href={source.url}>[{index + 1}] {source.title}</a><span className="note"> — retrieved <time dateTime={source.checkedAt}>{source.checkedAt}</time></span></li>)}</ol>
      <p className="note">{page.vendor} is named for comparison only. No affiliation or endorsement is implied.</p>
      <p><Link className="text-link" href={`/compare/${copy.pages.find(other => other.slug !== page.slug)!.slug}`}>Also compare {page.vendor === 'Hootsuite' ? 'Postiz' : 'Hootsuite'} →</Link></p>
    </section>
    <section className="section final-cta"><h2>Try one client workflow first</h2><p>Check the available networks and approval flow before moving your agency’s schedule.</p><Link className="primary" href="/login">Start free — no card needed</Link><SignInNotice /></section>
  </div>;
}
