import Link from 'next/link';
import copy from '@/content/compare.json';
import { seoMetadata } from '@/lib/seo';

export const metadata = seoMetadata({ title: 'Compare social publishing tools · Postial', description: 'Compare Postial with social publishing tools for agencies, including plans, supported workflows, approvals, and publishing status.', path: '/compare' });

export default function CompareIndex() {
  return <article className="legal"><h1>Compare Postial</h1><p>See how Postial compares with other social publishing tools for agencies.</p><ul>{copy.pages.map(page => <li key={page.slug}><Link className="text-link" href={`/compare/${page.slug}`}>{page.title}</Link><p>{page.description}</p></li>)}</ul></article>;
}
