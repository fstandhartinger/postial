import { NetworkAvailability } from '@/components/marketing/NetworkAvailability';
import { MarketingAccessStatus as AccessStatus } from '@/components/marketing/NetworkAvailability';
import { Badge } from '@/components/ui/badge';
import { Plans } from '@/components/marketing/Plans';
import { FAQ } from '@/components/marketing/FAQ';
import { words } from '@/components/marketing/copy';
export const metadata = { title: 'Pricing for Bluesky, Mastodon & Telegram agencies', description: 'Starter €19 or Agency €49/month including VAT for Bluesky, Mastodon and Telegram. Login-free Agency approvals. X, Threads and LinkedIn connect in Early access.', alternates: { canonical: '/pricing' } };
export default function Pricing() { return <div className="pricing-page"><header><Badge>Early access</Badge><p className="eyebrow">Pricing</p><h1>{words('Pricing', 'H2')}</h1><p>{words('Pricing', 'Sub')}</p><p>14-day free trial, no card needed</p></header><AccessStatus /><Plans checkout /><section className="section"><h2>Which networks do your clients need?</h2><NetworkAvailability source="pricing" /></section><section className="section faq-section"><h2>{words('FAQ', 'H2')}</h2><FAQ short /></section></div>; }
