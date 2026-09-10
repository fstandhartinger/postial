import source from '@/content/privacy.json';
import { LegalDocument } from '@/components/marketing/LegalDocument';
import { seoMetadata } from '@/lib/seo';
export const metadata = seoMetadata({ title: 'Postial privacy policy', description: 'Learn how Postial handles account, workspace, media, payment, cookie, retention, and privacy-rights information for the service.', path: '/privacy' });
export default function Privacy() { return <LegalDocument source={source} />; }
