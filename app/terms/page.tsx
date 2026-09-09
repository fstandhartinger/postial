import source from '@/content/terms.json';
import { LegalDocument } from '@/components/marketing/LegalDocument';
export const metadata = { title: 'Terms of Service', description: 'Postial subscription terms, VAT-inclusive pricing, free trial, cancellation, and consumer withdrawal rights.', alternates: { canonical: '/terms' } };
export default function Terms() { return <LegalDocument source={source} />; }
