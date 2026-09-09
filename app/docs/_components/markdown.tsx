import React, { Fragment, type ReactNode } from 'react';

// Deliberately small Markdown subset. React escapes every text node; no HTML is injected.
export function safeHelpHref(href: string) {
  return !/[\s\\\u0000-\u001f]/.test(href) && (/^\/(?!\/)/.test(href) || /^https:\/\//.test(href) || /^mailto:[^@]+@/.test(href));
}
function inline(text: string): ReactNode {
  return text.split(/(\[[^\]]+\]\([^)]+\)|`[^`]+`|\*\*[^*]+\*\*)/g).map((part, i) => {
    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link && safeHelpHref(link[2])) return <a key={i} href={link[2]}>{link[1]}</a>;
    if (part.startsWith('`') && part.endsWith('`')) return <code key={i}>{part.slice(1, -1)}</code>;
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={i}>{part.slice(2, -2)}</strong>;
    return <Fragment key={i}>{part}</Fragment>;
  });
}
export function HelpMarkdown({ source }: { source: string }) {
  const blocks = source.trim().split(/(```[^\n]*\n[\s\S]*?\n```)/g).flatMap(part => part.startsWith('```') ? [part] : part.split(/\n\s*\n/)).filter(Boolean);
  return <>{blocks.map((block, i) => {
    if (block.startsWith('```')) return <pre key={i}><code>{block.replace(/^```[^\n]*\n/, '').replace(/\n```$/, '')}</code></pre>;
    if (block.startsWith('### ')) return <h3 key={i}>{inline(block.slice(4))}</h3>;
    if (block.startsWith('## ')) return <h2 key={i}>{inline(block.slice(3))}</h2>;
    if (block.startsWith('# ')) return <h1 key={i}>{inline(block.slice(2))}</h1>;
    if (/^\d+\. /.test(block)) return <ol key={i}>{block.split('\n').map((line, j) => <li key={j}>{inline(line.replace(/^\d+\. /, ''))}</li>)}</ol>;
    if (block.startsWith('- ')) return <ul key={i}>{block.split('\n').map((line, j) => <li key={j}>{inline(line.slice(2))}</li>)}</ul>;
    return <p key={i}>{inline(block)}</p>;
  })}</>;
}
