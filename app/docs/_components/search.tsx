'use client';
import Link from 'next/link';
import { useState } from 'react';
import index from '@/content/help/index.json';
export function HelpSearch() {
  const [query, setQuery] = useState('');
  const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  const matches = terms.length ? index.filter(article => terms.every(term => `${article.title} ${article.summary} ${article.category} ${article.keywords}`.toLocaleLowerCase().includes(term))) : [];
  return <section className="help-search" aria-label="Search help">
    <label htmlFor="help-query">Search help articles</label>
    <input id="help-query" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Try trial, CSV or needs review" autoComplete="off" aria-controls="help-results" />
    <div id="help-results"><p role="status" aria-live="polite">{terms.length ? `${matches.length} matching ${matches.length === 1 ? 'article' : 'articles'}` : 'Search titles, summaries and article text.'}</p>
      {terms.length > 0 && (matches.length ? <ul>{matches.map(article => <li key={article.slug}><Link href={`/docs/${article.slug}`} onClick={() => setQuery('')}>{article.title}</Link><p>{article.summary}</p></li>)}</ul> : <p>No articles found. Try a shorter phrase or browse the categories.</p>)}
    </div>
  </section>;
}
