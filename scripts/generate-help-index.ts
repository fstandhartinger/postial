import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import index from '../content/help/index.json';
// Keep the reviewed category/order manifest; derive searchable text from Markdown.
const files = readdirSync('content/help').filter(file => file.endsWith('.md'));
if (files.length !== index.length || files.some(file => !index.some(item => `${item.slug}.md` === file))) throw new Error('Add each new article to the index category/order manifest first.');
const generated = index.map(article => {
  const source = readFileSync(`content/help/${article.slug}.md`, 'utf8');
  const [heading, summary] = source.trim().split(/\n\s*\n/);
  return { ...article, title: heading.replace(/^# /, ''), summary, keywords: source.split('## Related')[0] };
});
writeFileSync('content/help/index.json', JSON.stringify(generated, null, 2) + '\n');
console.log(`Generated ${generated.length} help index entries.`);
