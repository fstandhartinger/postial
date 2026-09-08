import { Fragment } from 'react';
function inline(text: string) {
  return text.split(/(\[[^\]]+\]\([^)]+\))/g).map((part, index) => {
    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    return link ? <a key={index} href={link[2]}>{link[1]}</a> : <Fragment key={index}>{part}</Fragment>;
  });
}
export function LegalDocument({ source }: { source: string }) {
  return <article className="legal">{source.trim().split(/\n\s*\n/).map((block, index) => {
    if (block.startsWith('### ')) return <h3 key={index}>{block.slice(4)}</h3>;
    if (block.startsWith('## ')) return <h2 key={index}>{block.slice(3)}</h2>;
    if (block.startsWith('# ')) return <h1 key={index}>{block.slice(2)}</h1>;
    if (block.startsWith('|')) {
      const rows = block.split('\n').filter(line => !/^\|[\s|:-]+$/.test(line)).map(line => line.split('|').slice(1, -1).map(cell => cell.trim()));
      return <div className="table-scroll" key={index} role="region" aria-label="Personal data, purposes, and legal bases" tabIndex={0}><table><thead><tr>{rows[0].map(cell => <th scope="col" key={cell}>{inline(cell)}</th>)}</tr></thead><tbody>{rows.slice(1).map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{inline(cell)}</td>)}</tr>)}</tbody></table></div>;
    }
    if (block.startsWith('- ')) return <ul key={index}>{block.split('\n').map((line, lineIndex) => <li key={lineIndex}>{inline(line.slice(2))}</li>)}</ul>;
    return <p key={index}>{inline(block)}</p>;
  })}</article>;
}
