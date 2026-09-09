import fs from 'node:fs';
import path from 'node:path';
import index from '@/content/help/index.json';
export const helpIndex = index;
export function helpSource(slug: string) {
  if (!helpIndex.some(article => article.slug === slug)) return null;
  return fs.readFileSync(path.join(process.cwd(), 'content/help', `${slug}.md`), 'utf8');
}
