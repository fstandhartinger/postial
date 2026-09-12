import { connection } from 'next/server';
import { NetworkAvailability } from '@/components/marketing/NetworkAvailability';
import { MarketingAccessStatus as AccessStatus } from '@/components/marketing/NetworkAvailability';
import { Badge } from '@/components/ui/badge';
import { Plans } from '@/components/marketing/Plans';
import { FAQ } from '@/components/marketing/FAQ';
import { words } from '@/components/marketing/copy';
import { recordPublicView } from '@/lib/funnel';
import { ClientBeacon } from '@/components/marketing/ClientBeacon';
import { faqEntries } from '@/components/marketing/FAQ';
import { jsonLd, seoMetadata, siteUrl } from '@/lib/seo';
import { plans } from '@/lib/plans';
export const metadata = seoMetadata({ title: 'Postial pricing for social publishing', description: 'Compare Starter and Agency plans for client social publishing, with VAT-inclusive pricing, a 14-day trial and supported network details.', path: '/pricing' });
export default async function Pricing() { await connection(); await recordPublicView('pricing_view', '/pricing'); const offerSchema = { '@context': 'https://schema.org', '@type': 'Product', name: 'Postial',
    description: 'Social publishing for agencies with client approval and recoverable failures.',
    brand: { '@type': 'Brand', name: 'Postial' },
    // Mirrors what the page itself shows. The landing page has carried offer data since the
    // start while the pricing page, of all pages, had none. Prices are the ones verified
    // against Stripe; lib/plans.ts is the single source so they cannot drift apart.
    offers: (Object.keys(plans) as Array<keyof typeof plans>).map(key => ({
      '@type': 'Offer', name: plans[key].name, price: String(plans[key].monthlyEuro), priceCurrency: 'EUR',
      url: new URL('/pricing', siteUrl).href, availability: 'https://schema.org/InStock',
      priceSpecification: { '@type': 'UnitPriceSpecification', price: String(plans[key].monthlyEuro),
        priceCurrency: 'EUR', valueAddedTaxIncluded: true, billingDuration: 1, unitCode: 'MON' },
    })) }; const faqSchema = { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faqEntries(true).map(entry => ({ '@type': 'Question', name: entry.question, acceptedAnswer: { '@type': 'Answer', text: entry.answer } })) }; return <div className="pricing-page"><ClientBeacon path={'/pricing'} /><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(offerSchema) }} /><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(faqSchema) }} /><header><Badge>Early access</Badge><p className="eyebrow">Pricing</p><h1>{words('Pricing', 'H2')}</h1><p>{words('Pricing', 'Sub')}</p><p>14-day free trial, no card needed</p></header><AccessStatus /><Plans checkout /><section className="section"><h2>Which networks do your clients need?</h2><NetworkAvailability source="pricing" /></section><section className="section faq-section"><h2>{words('FAQ', 'H2')}</h2><FAQ short /></section></div>; }
