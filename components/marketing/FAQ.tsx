import { MarketingAccessStatus as AccessStatus } from './NetworkAvailability';
import availability from '@/content/availability.json';
import { words } from './copy';
export function FAQ({ short = false }: { short?: boolean }) {
  return <div className="faq-list">{Array.from({ length: short ? 3 : 7 }, (_, index) => index + 1).map(number => <details key={number}><summary>{words('FAQ', `Question ${number}`)}</summary>{number === 4 ? <AccessStatus /> : <p>{number === 7 ? `Agency includes REST API and webhooks. ${availability.pending}.` : words('FAQ', `Answer ${number}`)}</p>}</details>)}</div>;
}
