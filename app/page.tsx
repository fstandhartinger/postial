import { connection } from 'next/server';
import { MarketingAccessStatus as AccessStatus } from '@/components/marketing/NetworkAvailability';
import { NetworkAvailability } from '@/components/marketing/NetworkAvailability';
import Link from 'next/link';
import { items, words, type Section } from '@/components/marketing/copy';
import { Plans } from '@/components/marketing/Plans';
import { FAQ, faqEntries } from '@/components/marketing/FAQ';
import { jsonLd, seoMetadata, siteUrl } from '@/lib/seo';
import { plans } from '@/lib/plans';
import { DemoLink } from '@/components/marketing/DemoLink';
import { LazyApprovalDemo } from '@/components/marketing/LazyApprovalDemo';
import { SignInNotice } from '@/components/marketing/SignInNotice';
import { recordPublicView } from '@/lib/funnel';
import { ClientBeacon } from '@/components/marketing/ClientBeacon';
const description = 'Schedule client posts with approvals, status tracking and retries for agencies using Bluesky, Mastodon and Telegram. Agency is €49/month.';
export const metadata = seoMetadata({ title: 'Postial | Social publishing for agencies', description, path: '/' });
function FactGrid({ section }: { section: Section }) {
  const content = items(section);
  return <div className={`marketing-grid ${section === 'Features' ? 'two features-grid' : 'three'}`}>{content.map((item, index) => item.label === 'H3' ? <article key={item.text}><div className="feature-mark" aria-hidden="true"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="3" y="3" width="18" height="18" rx="5"/><path d="m7 12 3 3 7-7"/></svg></div><h3>{item.text}</h3>{content.slice(index + 1, content.findIndex((next, nextIndex) => nextIndex > index && next.label === 'H3') === -1 ? undefined : content.findIndex((next, nextIndex) => nextIndex > index && next.label === 'H3')).filter(next => next.label !== 'Fair-comparison note').map(next => next.label === 'Badge' ? <span className="badge" key={next.text}>{next.text}</span> : <p className={next.label.includes('note') || next.label === 'Note' ? 'note' : ''} key={next.text}>{next.text}</p>)}</article> : null)}</div>;
}
export default async function Home() {
  await connection();
  await recordPublicView('landing_view', '/');
  const schema = { '@context': 'https://schema.org', '@type': 'SoftwareApplication', name: 'Postial', applicationCategory: 'BusinessApplication', operatingSystem: 'Web', url: siteUrl, description, offers: Object.values(plans).map(plan => ({ '@type': 'Offer', name: plan.name, price: String(plan.monthlyEuro), priceCurrency: 'EUR', url: `${siteUrl}/pricing` })) };
  const faqSchema = { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faqEntries().map(entry => ({ '@type': 'Question', name: entry.question, acceptedAnswer: { '@type': 'Answer', text: entry.answer } })) };
  return <><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(schema) }} /><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(faqSchema) }} />
    <ClientBeacon path={'/'} />
    <section className="hero"><p className="eyebrow">{words('Hero', 'Eyebrow')}</p><h1>{words('Hero', 'H1')}</h1><p className="hero-sub">{words('Hero', 'Sub')}</p><div className="actions"><Link prefetch={false} className="primary" href="/login">{words('Hero', 'Primary CTA → /signup')}</Link><DemoLink>{words('Hero', 'Secondary CTA → #demo')}</DemoLink></div><SignInNotice /><p className="note">{words('Hero', 'Trial note')}</p><p className="note">{words('Hero', 'Plan note')}</p></section>
    <aside className="audience"><strong>{words('Social-proof alternative', 'Statement')}</strong><p>{words('Social-proof alternative', 'Supporting label')}</p></aside>
    <AccessStatus />
    <section className="section"><h2>{words('Pain points', 'H2')}</h2><FactGrid section="Pain points" /></section>
    <section className="section" id="features"><h2>{words('Features', 'H2')}</h2><FactGrid section="Features" /></section>
    <section className="section"><h2>{words('How it works', 'H2')}</h2><ol className="marketing-grid three steps">{[1, 2, 3].map(step => <li key={step}><h3>{words('How it works', `Step ${step} label`)}</h3><p>{words('How it works', `Step ${step} body`)}</p></li>)}</ol></section>
    <section className="section demo-section" id="demo"><h2 id="demo-heading" tabIndex={-1}>{words('Interactive demo', 'H2')}</h2><p>{words('Interactive demo', 'Sub')}</p><LazyApprovalDemo notice={<SignInNotice />} /></section>
    <section className="section networks"><h2>{words('Networks', 'H2')}</h2><NetworkAvailability /><Link prefetch={false} className="text-link" href="/roadmap">Roadmap and launch notifications →</Link></section>
    <section className="section" id="pricing"><h2>{words('Pricing', 'H2')}</h2><p>{words('Pricing', 'Sub')}</p><Plans /><Link prefetch={false} className="text-link" href="/pricing">Pricing →</Link></section>
    <section className="section"><h2>{words('Comparison', 'H2')}</h2><p className="section-intro">{words('Comparison', 'Body')}</p><FactGrid section="Comparison" /><p className="note">{words('Comparison', 'Fair-comparison note')}</p></section>
    <section className="section faq-section" id="faq"><h2>{words('FAQ', 'H2')}</h2><FAQ /></section>
    <section className="section final-cta"><h2>{words('Final CTA', 'H2')}</h2><p>{words('Final CTA', 'Body')}</p><Link prefetch={false} className="primary" href="/login">{words('Final CTA', 'CTA → /signup')}</Link><SignInNotice /></section>
  </>;
}
