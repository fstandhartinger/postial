import Link from 'next/link';
import copy from '@/content/compare.json';
import { networkNames } from '@/components/marketing/NetworkAvailability';
import { ClientBeacon } from '@/components/marketing/ClientBeacon';
import { seoMetadata } from '@/lib/seo';

const hydrateNetworks = (text: string) => text
  .replaceAll('{liveNetworkNames}', networkNames('live'))
  .replaceAll('{earlyAccessNetworkNames}', networkNames('preparation'));

export const metadata = seoMetadata({ title: 'Compare social publishing tools · Postial', description: 'Compare Postial with social publishing tools for agencies, including plans, supported workflows, approvals, and publishing status.', path: '/compare' });

export default async function CompareIndex() {
  return <article className="legal"><ClientBeacon path={'/compare'} /><h1>Compare Postial</h1><p>See how Postial compares with other social publishing tools for agencies.</p><ul>{copy.pages.map(page => <li key={page.slug}><Link className="text-link" href={`/compare/${page.slug}`}>{hydrateNetworks(page.title)}</Link><p>{hydrateNetworks(page.description)}</p></li>)}</ul></article>;
}
