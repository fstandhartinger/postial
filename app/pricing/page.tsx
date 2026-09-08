import { Plans } from '@/components/marketing/Plans';
import { FAQ } from '@/components/marketing/FAQ';
import { words } from '@/components/marketing/copy';
export const metadata = { title: 'Pricing', description: 'Starter €19 or Agency €49 per month, including VAT. 14-day free trial, no card needed.', alternates: { canonical: '/pricing' } };
export default function Pricing() { return <div className="pricing-page"><header><p className="eyebrow">Pricing</p><h1>{words('Pricing', 'H2')}</h1><p>{words('Pricing', 'Sub')}</p><p>14-day free trial, no card needed</p></header><Plans checkout /><section className="section faq-section"><h2>{words('FAQ', 'H2')}</h2><FAQ short /></section></div>; }
