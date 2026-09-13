import { networkNames, networkSummary } from '@/components/marketing/NetworkAvailability';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { MarketingAccessStatus as AccessStatus } from '@/components/marketing/NetworkAvailability';
import { SignInNotice } from '@/components/marketing/SignInNotice';
import copy from '@/content/compare.json';
import availability from '@/content/availability.json';
import styles from '../compare.module.css';
import { recordPublicView } from '@/lib/funnel';
import { ClientBeacon } from '@/components/marketing/ClientBeacon';
import { jsonLd, seoMetadata } from '@/lib/seo';
import { plans, TRIAL_DAYS } from '@/lib/plans';

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
const liveNetworkNames = networkNames('live');
const earlyAccessNetworkNames = networkNames('preparation');
const hydrateNetworkText = (text: string) => text.replace(/\{(liveNetworkNames|earlyAccessNetworkNames)\}/g, (_, key) => key === 'liveNetworkNames' ? liveNetworkNames : earlyAccessNetworkNames);
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const page = comparison((await params).slug);
  return seoMetadata({ title: hydrateNetworkText(page.title), description: hydrateNetworkText(page.description), path: `/compare/${page.slug}` });
}
export default async function ComparePage({ params }: Props) {
  const { slug } = await params;
  const page = comparison(slug);
  // Record which comparison was read, not a fixed '/compare' for all of them, and only
  // after the slug is known to exist so probed URLs cannot inflate the count.
  await recordPublicView('compare_view', `/compare/${slug}`);
  const networkText=networkSummary;
  const featureText=`Available today: ${availability.available.join('; ')}. ${availability.pending}. ${networkText}`;
  const own = {
    starterPrice: `€${plans.starter.monthlyEuro}/month`, agencyPrice: `€${plans.agency.monthlyEuro}/month`,
    starterBrands: String(plans.starter.brands), agencyBrands: String(plans.agency.brands),
    starterSeats: String(plans.starter.seats), agencySeats: String(plans.agency.seats), trialDays: String(TRIAL_DAYS),
  };
  const hydrate = (text: string) => hydrateNetworkText(text).replace(/\{(starterPrice|agencyPrice|starterBrands|agencyBrands|starterSeats|agencySeats|trialDays)\}/g, (_, key) => own[key as keyof typeof own]);
  const feature = (index: number) => index === 2 ? availability.available[2] : index === 3 ? availability.available[3] : index === 4 ? `${availability.available[6]}. ${availability.pending}` : index === 5 ? networkText : [
    `Starter: ${own.starterPrice} including VAT; ${own.starterBrands} brands, ${own.starterSeats} user.`,
    `Agency: ${own.agencyPrice} including VAT; ${own.agencyBrands} brands, ${own.agencySeats} users.`,
    '', '', '', '',
    `Data is hosted in Germany; publishing still sends content to the selected networks.`,
    `${own.trialDays}-day trial, no card needed. Cancel anytime.`,
  ][index];
  const cells=copy.labels.map((_,i) => feature(i));
  const faq=page.faq.map(f=>({...f,question: hydrate(f.question),answer: hydrate(/September.*rollout|rolling out|verify readiness/i.test(f.answer)?featureText:f.answer)}));
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
    <ClientBeacon path={`/compare/${slug}`} />
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(schema) }} />
    <section className="hero">
      <p className="eyebrow">Postial comparisons · September 2026</p>
      <h1>{page.title}</h1>
      <p className="hero-sub">{hydrate(page.intro)}</p>
      <div className="actions"><Link className="primary" href="/login">Start free — no card needed</Link><Link className="secondary" href="/pricing">See pricing</Link></div>
      <SignInNotice />
      <p className="note">Starter {own.starterPrice} · Agency {own.agencyPrice} · including VAT · {own.trialDays} days free · cancel anytime</p>
      <AccessStatus />
    </section>
    <aside className="audience"><h2>Who this is for</h2><p>{hydrate(page.audience)}</p></aside>
    <section className="section" aria-labelledby="comparison-heading">
      <h2 id="comparison-heading">Postial and {page.vendor}, side by side</h2>
      <p className="section-intro">{copy.methodology}</p>
      <p className="note" id="table-help">On a small screen, scroll the table horizontally to read both products.</p>
      <div className={styles.tableScroll} role="region" aria-labelledby="comparison-heading" aria-describedby="table-help" tabIndex={0}>
        <table className={styles.table}>
          <caption>Published offers and documented capabilities, checked {copy.checkedAt}. Postial availability is listed above.</caption>
          <thead><tr><th scope="col">Agency requirement</th><th scope="col">Postial · early access</th><th scope="col">{page.vendor}</th></tr></thead>
          <tbody>{copy.labels.map((label, index) => <tr key={label}><th scope="row">{label}</th><td>{cells[index]}</td><td>{hydrate(page.vendorCells[index].text)} {citations(page.vendorCells[index].sources)}</td></tr>)}</tbody>
        </table>
      </div>
    </section>
    <section className="section"><h2>Postial’s network reality</h2><p>{networkText}</p><p>Available today: {availability.available.join('; ')}. {availability.pending}</p><p><Link className="text-link" href="/pricing">See the full pricing and availability matrix</Link> · <Link className="text-link" href="/docs">Read the help center</Link> · <Link className="text-link" href={`/compare/${copy.pages.find(other => other.slug !== page.slug)!.slug}`}>Compare the other alternative</Link></p></section>
    <section className="section"><div className="marketing-grid two">
      <article className="panel"><h2>Where Postial fits better</h2><p>{hydrate(page.fits)}</p></article>
      <article className="panel"><h2>Where {page.vendor} fits better</h2><p>{hydrate(page.vendorFits)} {citations(page.vendorFitSources)}</p></article>
    </div></section>
    <section className="section"><div className="marketing-grid two">
      <article className="panel"><h2>Who should not switch yet</h2><p>{hydrate(page.notFor)} {citations(page.vendorFitSources)}</p></article>
      <article className="panel"><h2>What Postial does not have</h2><p>{hydrate(page.notHave)} {citations(page.vendorFitSources)}</p></article>
    </div></section>
    <section className="section"><h2>The workflow, including a failed post</h2><div className="marketing-grid three">
      <article className="panel"><h3>Review without another account</h3><p>On Agency, create a client approval link. The reviewer can inspect and decide without a Postial login; the approval result remains part of the post workflow.</p></article>
      <article className="panel"><h3>If publishing fails</h3><p>Postial shows publishing status and clear errors, with retries available. Check the affected post, correct the provider or content issue, then retry; do not assume a failed post was published.</p></article>
      <article className="panel"><h3>Before moving everything</h3><p>Run one client through the {own.trialDays}-day trial, verify each profile, and keep unsupported or early-access networks in the existing tool until your test succeeds.</p></article>
    </div></section>
    <section className="section"><h2>How to switch</h2><ol className="marketing-grid three steps">{copy.switchSteps.map(step => <li key={step.title}><h3>{step.title}</h3><p>{hydrate(step.body)}</p></li>)}</ol></section>
    <section className="section faq-section"><h2>Frequently asked questions</h2><div className="faq-list">{faq.map(faq => <details key={faq.question}><summary>{faq.question}</summary><p>{faq.answer}</p></details>)}</div></section>
    <section className={`section ${styles.sources}`} aria-labelledby="sources-heading"><h2 id="sources-heading">Sources and pricing notes</h2><p>{copy.priceFootnote}</p><p className="note">Vendor terms can change. Every vendor statement on this page points to a public source below, with retrieval date also recorded in <code>work/compare-sources.md</code>. Postial facts describe the early-access offer; this is a comparison published by Postial.</p>
      <ol>{page.sources.map((source, index) => <li id={`source-${source.id}`} key={source.id}><a className="text-link" href={source.url}>[{index + 1}] {source.title}</a><span className="note"> — retrieved <time dateTime={source.checkedAt}>{source.checkedAt}</time></span></li>)}</ol>
      <p className="note">{page.vendor} is named for comparison only. No affiliation or endorsement is implied.</p>
      <p><Link className="text-link" href={`/compare/${copy.pages.find(other => other.slug !== page.slug)!.slug}`}>Also compare {page.vendor === 'Hootsuite' ? 'Postiz' : 'Hootsuite'} →</Link></p>
    </section>
    <section className="section final-cta"><h2>Try one client workflow first</h2><p>Check the available networks and approval flow before moving your agency’s schedule.</p><Link className="primary" href="/login">Start free — no card needed</Link><SignInNotice /></section>
  </div>;
}
