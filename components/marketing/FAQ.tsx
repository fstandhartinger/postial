import { MarketingAccessStatus as AccessStatus } from './NetworkAvailability';
import availability from '@/content/availability.json';
import { words } from './copy';
export function faqEntries(short = false) {
  return Array.from({ length: short ? 3 : 7 }, (_, index) => index + 1).map(number => ({
    question: words('FAQ', `Question ${number}`),
    answer: number === 7 ? `Agency includes REST API and webhooks. ${availability.pending}.` : number === 4 ? 'Live networks are Bluesky, Mastodon and Telegram. Other connections depend on provider access and conditions.' : words('FAQ', `Answer ${number}`),
  }));
}
export function FAQ({ short = false }: { short?: boolean }) {
  return <div className="faq-list">{faqEntries(short).map((entry, index) => <details key={entry.question}><summary>{entry.question}</summary>{index === 3 ? <AccessStatus /> : <p>{entry.answer}</p>}</details>)}</div>;
}
