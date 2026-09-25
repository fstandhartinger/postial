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
import { ClientBeacon } from '@/components/marketing/ClientBeacon';
import { HeroVisual } from '@/components/marketing/HeroVisual';
import { organizationSchema } from '@/lib/seo';
const description = 'Schedule client posts with approvals, status tracking and retries for agencies using Bluesky, Mastodon and Telegram. Agency is €49/month.';
export const metadata = seoMetadata({ title: 'Postial | Social publishing for agencies', description, path: '/' });
const icon = (paths: string) => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: paths }} />;
const featureIcons = [
  '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 13 9 5 9-5"/>',
  '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  '<path d="m8 8-5 4 5 4M16 8l5 4-5 4M14 4l-4 16"/>',
];
const painIcons = [
  '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z"/><path d="M9 11h6M9 14h4"/>',
  '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  '<path d="M4 7h16v12H4z"/><path d="M4 11h16M8 15h3"/>',
];
function FactGrid({ section }: { section: Section }) {
  const content = items(section);
  const icons = section === 'Features' ? featureIcons : section === 'Pain points' ? painIcons : null;
  return <div className={`marketing-grid ${section === 'Features' ? 'two features-grid' : 'three'}`}>{content.map((item, index) => item.label === 'H3' ? ((card: number) => <article className="fact" key={item.text}>{icons ? <div className="feature-mark" aria-hidden="true">{icon(icons[card % icons.length])}</div> : <span className="fact-index" aria-hidden="true">{String(card + 1).padStart(2, '0')}</span>}<h3>{item.text}</h3>{content.slice(index + 1, content.findIndex((next, nextIndex) => nextIndex > index && next.label === 'H3') === -1 ? undefined : content.findIndex((next, nextIndex) => nextIndex > index && next.label === 'H3')).filter(next => next.label !== 'Fair-comparison note').map(next => next.label === 'Badge' ? <span className="badge" key={next.text}>{next.text}</span> : <p className={next.label.includes('note') || next.label === 'Note' ? 'note' : ''} key={next.text}>{next.text}</p>)}</article>)(content.slice(0, index).filter(prev => prev.label === 'H3').length) : null)}</div>;
}
export default async function Home() {
  const schema = { '@context': 'https://schema.org', '@type': 'SoftwareApplication', name: 'Postial', applicationCategory: 'BusinessApplication', operatingSystem: 'Web', url: siteUrl, description, offers: Object.values(plans).map(plan => ({ '@type': 'Offer', name: plan.name, price: String(plan.monthlyEuro), priceCurrency: 'EUR', url: `${siteUrl}/pricing` })) };
  const faqSchema = { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faqEntries().map(entry => ({ '@type': 'Question', name: entry.question, acceptedAnswer: { '@type': 'Answer', text: entry.answer } })) };
  return <><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(schema) }} /><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(faqSchema) }} /><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(organizationSchema) }} />
    <ClientBeacon path={'/'} />
    <section className="hero home-hero">
      <div className="hero-copy">
        <p className="eyebrow"><span className="eyebrow-dot" aria-hidden="true" />{words('Hero', 'Eyebrow')}</p>
        <h1>{words('Hero', 'H1')}</h1>
        <p className="hero-sub">{words('Hero', 'Sub')}</p>
        <div className="actions"><Link prefetch={false} className="primary" href="/login">{words('Hero', 'Primary CTA → /signup')}</Link><DemoLink>{words('Hero', 'Secondary CTA → #demo')}</DemoLink></div>
        <SignInNotice />
        <ul className="hero-notes"><li>{words('Hero', 'Trial note')}</li><li>{words('Hero', 'Plan note')}</li></ul>
      </div>
      <HeroVisual />
    </section>
    <section className="status-strip" aria-label="What is available today">
      <aside className="audience"><strong>{words('Social-proof alternative', 'Statement')}</strong><p>{words('Social-proof alternative', 'Supporting label')}</p></aside>
      <AccessStatus />
    </section>
    <section className="section"><p className="kicker">The problem</p><h2>{words('Pain points', 'H2')}</h2><FactGrid section="Pain points" /></section>
    <section className="section" id="features"><p className="kicker">Features</p><h2>{words('Features', 'H2')}</h2><FactGrid section="Features" /></section>
    <section className="section"><p className="kicker">How it works</p><h2>{words('How it works', 'H2')}</h2><ol className="marketing-grid three steps">{[1, 2, 3].map(step => <li key={step}><h3>{words('How it works', `Step ${step} label`)}</h3><p>{words('How it works', `Step ${step} body`)}</p></li>)}</ol></section>
    <section className="section demo-section" id="demo"><p className="kicker">Interactive demo</p><h2 id="demo-heading" tabIndex={-1}>{words('Interactive demo', 'H2')}</h2><p>{words('Interactive demo', 'Sub')}</p><LazyApprovalDemo notice={<SignInNotice />} /></section>
    <section className="section networks"><p className="kicker">Networks</p><h2>{words('Networks', 'H2')}</h2><NetworkAvailability /><p className="section-links"><Link prefetch={false} className="text-link" href="/roadmap">Roadmap and launch notifications →</Link> <Link prefetch={false} className="text-link" href="/bluesky-scheduler">Bluesky scheduling →</Link> <Link prefetch={false} className="text-link" href="/mastodon-scheduler">Mastodon scheduling →</Link> <Link prefetch={false} className="text-link" href="/telegram-channel-scheduler">Telegram channel scheduling →</Link></p></section>
    <section className="section" id="pricing"><p className="kicker">Pricing</p><h2>{words('Pricing', 'H2')}</h2><p className="section-intro">{words('Pricing', 'Sub')}</p><Plans /><Link prefetch={false} className="text-link" href="/pricing">Pricing →</Link></section>
    <section className="section"><p className="kicker">Compare</p><h2>{words('Comparison', 'H2')}</h2><p className="section-intro">{words('Comparison', 'Body')}</p><FactGrid section="Comparison" /><p className="note">{words('Comparison', 'Fair-comparison note')}</p><p className="section-links"><Link prefetch={false} className="text-link" href="/compare">All comparisons →</Link> <Link prefetch={false} className="text-link" href="/social-media-client-approval">How client approval works →</Link></p></section>
    <section className="section faq-section" id="faq"><p className="kicker">FAQ</p><h2>{words('FAQ', 'H2')}</h2><FAQ /></section>
    <section className="section final-cta"><h2>{words('Final CTA', 'H2')}</h2><p>{words('Final CTA', 'Body')}</p><Link prefetch={false} className="primary" href="/login">{words('Final CTA', 'CTA → /signup')}</Link><SignInNotice /></section>
  </>;
}
