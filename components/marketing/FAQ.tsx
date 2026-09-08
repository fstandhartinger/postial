import { words } from './copy';
export function FAQ({ short = false }: { short?: boolean }) {
  return <div className="faq-list">{Array.from({ length: short ? 3 : 7 }, (_, index) => index + 1).map(number => <details key={number}><summary>{words('FAQ', `Question ${number}`)}</summary><p>{words('FAQ', `Answer ${number}`)}</p></details>)}</div>;
}
