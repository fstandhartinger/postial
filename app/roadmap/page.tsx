import { connection } from 'next/server';
import { NetworkAvailability, networkSummary } from '@/components/marketing/NetworkAvailability';
import changelog from '@/content/changelog.json';
import { seoMetadata } from '@/lib/seo';
export const metadata = seoMetadata({ title: 'Postial roadmap and networks', description: 'See Postial\'s live networks, early-access connections, planned platforms, and recent product changes for agency publishing with clear status notes.', path: '/roadmap' });
export default async function Roadmap() {
  await connection();
  return <><section className="section"><p className="eyebrow">Postial roadmap</p><h1>Live today. Clear about what’s next.</h1><p>{networkSummary}</p><NetworkAvailability source="roadmap" /></section><section className="section"><h2>Changelog</h2><ol className="space-y-6">{changelog.slice(0, 8).map(entry => <li key={entry.title}><time dateTime={entry.date}>{entry.date}</time><h3>{entry.title}</h3><p>{entry.body}</p></li>)}</ol></section></>;
}
