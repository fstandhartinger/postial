import Link from 'next/link';
import copy from '@/content/compare.json';
import { recordPublicView } from '@/lib/funnel';

export const metadata = {
  title: 'Compare social publishing tools',
  description: 'Compare Postial with other social publishing tools for agencies.',
  alternates: { canonical: '/compare' },
};

export default async function CompareIndex() {
  await recordPublicView('compare_view', '/compare');
  return <article className="legal"><h1>Compare Postial</h1><p>See how Postial compares with other social publishing tools for agencies.</p><ul>{copy.pages.map(page => <li key={page.slug}><Link className="text-link" href={`/compare/${page.slug}`}>{page.title}</Link><p>{page.description}</p></li>)}</ul></article>;
}
