import source from '@/content/privacy.json';
import { LegalDocument } from '@/components/marketing/LegalDocument';
export const metadata = { title: 'Privacy Policy', description: 'How SocialMint processes personal data, cookies, payments, retention, and your privacy rights.', alternates: { canonical: '/privacy' } };
export default function Privacy() { return <LegalDocument source={source} />; }
