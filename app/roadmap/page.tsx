import { NetworkAvailability } from '@/components/marketing/NetworkAvailability';
import changelog from '@/content/changelog.json';
export const metadata = { title: 'Roadmap | Live networks and what’s next', description: 'Bluesky, Mastodon and Telegram are live. X, Threads and LinkedIn connect in Early access; Instagram and Facebook are planned. Follow network launches.', alternates: { canonical: '/roadmap' } };
export default function Roadmap() {
  return <><section className="section"><p className="eyebrow">Postial roadmap</p><h1>Live today. Clear about what’s next.</h1><p>Bluesky, Mastodon and Telegram are live. X, Threads and LinkedIn can be connected in Early access; publishing is subject to provider conditions. Instagram and Facebook remain planned and depend on platform review, with no confirmed release date.</p><NetworkAvailability source="roadmap" /></section><section className="section"><h2>Changelog</h2><ol className="space-y-6">{changelog.slice(0, 8).map(entry => <li key={entry.title}><time dateTime={entry.date}>{entry.date}</time><h3>{entry.title}</h3><p>{entry.body}</p></li>)}</ol></section></>;
}
