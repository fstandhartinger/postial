import Link from 'next/link';
import { seoMetadata } from '@/lib/seo';

export const metadata = seoMetadata({ title: 'Postial legal information', description: 'Find Postial\'s privacy policy, terms of service, data processing agreement, and provider information in one clear legal overview.', path: '/legal' });

export default function LegalIndex() {
  return <article className="legal"><h1>Legal information</h1><p>Policies and legal documents for Postial.</p><ul><li><Link className="text-link" href="/impressum">Impressum</Link></li><li><Link className="text-link" href="/privacy">Privacy Policy</Link></li><li><Link className="text-link" href="/terms">Terms of Service</Link></li><li><Link className="text-link" href="/legal/dpa">Data Processing Agreement</Link></li></ul></article>;
}
