import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BULK_LIMIT, JSON_LIMIT } from './body';
/** The URL alone cannot grant bulk limits: any Server Action can be posted to that URL. */
export async function actionBodyLimit(request: Request) {
  if(new URL(request.url).pathname !== '/app/posts/bulk') return JSON_LIMIT;
  const id=request.headers.get('next-action');
  if(!id || !/^[0-9a-f]{40,64}$/.test(id)) return JSON_LIMIT;
  for(const dir of ['.next/server','.next/dev/server']) {
    try {
      const manifest=JSON.parse(await readFile(join(process.cwd(),dir,'server-reference-manifest.json'),'utf8'));
      const action=manifest.node?.[id];
      if(action?.filename === 'app/app/posts/bulk/actions.ts' && action?.exportedName === 'saveBulkAction') return BULK_LIMIT;
    } catch { /* Missing/unknown action metadata fails closed to the ordinary limit. */ }
  }
  return JSON_LIMIT;
}
