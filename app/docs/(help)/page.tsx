import Link from 'next/link';
import { helpIndex } from '../content';
import { recordPublicView } from '@/lib/funnel';
export const metadata = { title: 'Help center', description: 'Learn to connect channels, plan posts, collect client approvals and manage your Postial workspace.', alternates: { canonical: '/docs' } };
export default async function HelpHome() {
  await recordPublicView('docs_view', '/docs');
  const categories = [...new Set(helpIndex.map(article => article.category))];
  return <article className="help-article"><h1>How can we help?</h1><p>From your first brand to a reliable publishing workflow: find practical steps for your Postial workspace.</p><div className="help-categories">{categories.map(category => <section key={category}><h2>{category}</h2><ul>{helpIndex.filter(article => article.category === category).map(article => <li key={article.slug}><Link href={`/docs/${article.slug}`}>{article.title}</Link><p>{article.summary}</p></li>)}</ul></section>)}</div></article>;
}
