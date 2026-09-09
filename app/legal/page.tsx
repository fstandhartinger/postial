import Link from 'next/link';

export const metadata = {
  title: 'Legal information',
  description: 'Postial legal information, privacy, terms and data processing agreement.',
  alternates: { canonical: '/legal' },
};

export default function LegalIndex() {
  return <article className="legal"><h1>Legal information</h1><p>Policies and legal documents for Postial.</p><ul><li><Link className="text-link" href="/impressum">Impressum</Link></li><li><Link className="text-link" href="/privacy">Privacy Policy</Link></li><li><Link className="text-link" href="/terms">Terms of Service</Link></li><li><Link className="text-link" href="/legal/dpa">Data Processing Agreement</Link></li></ul></article>;
}
