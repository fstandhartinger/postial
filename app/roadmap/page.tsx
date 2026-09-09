import { NetworkAvailability } from '@/components/marketing/NetworkAvailability';
import changelog from '@/content/changelog.json';
export const metadata = { title: 'Roadmap | Live networks and what’s next', description: 'Bluesky, Mastodon and Telegram are live. X and Threads await developer approval; LinkedIn, Instagram and Facebook are planned. Follow network launches.', alternates: { canonical: '/roadmap' } };
export default function Roadmap() {
  return <><section className="section"><p className="eyebrow">SocialMint roadmap</p><h1>Live today. Clear about what’s next.</h1><p>Choose the networks your clients use. Platform reviews determine access; upcoming integrations have no confirmed release dates.</p><NetworkAvailability source="roadmap" /></section><section className="section"><h2>Changelog</h2><ol className="space-y-6">{changelog.slice(0, 8).map(entry => <li key={entry.title}><time dateTime={entry.date}>{entry.date}</time><h3>{entry.title}</h3><p>{entry.body}</p></li>)}</ol></section></>;
}
