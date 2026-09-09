import Link from 'next/link';
import { helpIndex } from '../content';
import { HelpSearch } from '../_components/search';
import './help.css';
export default function HelpLayout({ children }: { children: React.ReactNode }) {
  const categories = [...new Set(helpIndex.map(article => article.category))];
  return <div className="help-shell">
    <aside><nav aria-label="Help categories"><Link className="help-home" href="/docs">Postial Help</Link>{categories.map(category => <section key={category}><h2>{category}</h2><ul>{helpIndex.filter(article => article.category === category).map(article => <li key={article.slug}><Link href={`/docs/${article.slug}`}>{article.title}</Link></li>)}</ul></section>)}<Link href="/docs/api">API reference ↗</Link></nav></aside>
    <div className="help-content"><HelpSearch />{children}</div>
  </div>;
}
