import { sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { version } from '@/package.json';
import journal from '@/drizzle/meta/_journal.json';
import { workerHealth } from '@/lib/publishing/state';
import { anonymousLimit } from '@/lib/rate-limit';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request = new Request('http://localhost/healthz')) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([(async () => {
      const limited = await anonymousLimit(request.headers, 'healthz', 60);
      if (limited) return limited;
      const [row] = await getDb().execute(sql`select count(*)::integer as applied, max(created_at) as latest from drizzle.__drizzle_migrations`);
      const applied = Number(row.applied), dbLatest = Number(row.latest);
      // A rolled-back image's journal legitimately trails the migrated database; report the
      // newest journal entry the database has reached instead of turning every rollback into a 503.
      const known = journal.entries.filter(entry => entry.when <= dbLatest).sort((a, b) => b.when - a.when);
      const latest = known[0]?.tag ?? null;
      const dbAhead = journal.entries.length > 0 && dbLatest > journal.entries[journal.entries.length - 1].when;
      const worker = workerHealth();
      const ok = applied >= journal.entries.length && latest !== null && (!worker.expected || worker.ageSeconds <= 300);
      return Response.json({ok,db:true,version,migrations:{applied,latest,dbAhead},worker},{status:ok?200:503,headers:{'Cache-Control':'no-store'}});
    })(), new Promise<Response>(resolve => {timer=setTimeout(()=>resolve(Response.json({ok:false},{status:503})),2000);})]);
  } catch { return Response.json({ok:false},{status:503}); }
  finally { clearTimeout(timer); }
}
