import source from '@/content/terms.json';
import { LegalDocument } from '@/components/marketing/LegalDocument';
import { seoMetadata } from '@/lib/seo';
export const metadata = seoMetadata({ title: 'Postial terms of service', description: 'Review Postial subscription terms, VAT-inclusive pricing, the free trial, cancellation, publishing limits, and consumer withdrawal rights.', path: '/terms' });
export default function Terms() { return <LegalDocument source={source} />; }
