import { sql, type SQL } from 'drizzle-orm';
import { getDb } from '@/db';
import { postialVisitDaily } from '@/db/schema';
import { classifyVisitRequest, VISIT_STATS_MAX_KEYS, VISIT_STATS_RETENTION_MONTHS, type VisitHit } from '@/lib/visit-stats';
import { visitReport } from '@/lib/visit-report';

// The Node side of the visitor statistics. Page views are added to in-memory daily totals and
// written as additive increments to postial_visit_daily once a minute. The accumulator holds no
// request-level data; on a failed write the totals are put back, subject to the key cap and to
// the current/previous UTC day, and dropped afterwards. Statistics never block a page: the only
// proxy-facing entry point is synchronous, guarded by the caller and never throws.

const FLUSH_MS = 60_000;
const RETENTION_EVERY_MS = 60 * 60_000;

type VisitCountRow = { day: string; path: string; referrerHost: string; views: number; visits: number };
type VisitCounterDatabase = { execute: (statement: SQL) => Promise<unknown> };
type VisitCounterState = { acc: Map<string, VisitCountRow>; timer: NodeJS.Timeout | null; flushing: Promise<void> | null; retainedAt: number };

const counterGlobal = globalThis as typeof globalThis & { __postialVisitCounter?: VisitCounterState };
const state: VisitCounterState = (counterGlobal.__postialVisitCounter ??= { acc: new Map(), timer: null, flushing: null, retainedAt: 0 });

const keyOf = (day: string, path: string, referrerHost: string) => `${day}|${path}|${referrerHost}`;

function addVisitHit(hit: VisitHit, now: number): void {
  const day = new Date(now).toISOString().slice(0, 10);
  const key = keyOf(day, hit.path, hit.referrerHost);
  if (!state.acc.has(key) && state.acc.size >= VISIT_STATS_MAX_KEYS) return;
  const row = state.acc.get(key) ?? { day, path: hit.path, referrerHost: hit.referrerHost, views: 0, visits: 0 };
  row.views += 1;
  if (hit.visit) row.visits += 1;
  state.acc.set(key, row);
}

function takeVisitCounts(): VisitCountRow[] {
  const taken = [...state.acc.values()];
  state.acc = new Map();
  return taken;
}

/** Put back totals whose write failed; totals older than yesterday (UTC) are dropped, not kept in memory. */
function restoreVisitCounts(taken: VisitCountRow[], now: number): void {
  const oldest = new Date(now - 86_400_000).toISOString().slice(0, 10);
  for (const row of taken) {
    if (row.day < oldest) continue;
    const pending = state.acc.get(keyOf(row.day, row.path, row.referrerHost));
    if (pending) { pending.views += row.views; pending.visits += row.visits; }
    else if (state.acc.size < VISIT_STATS_MAX_KEYS) state.acc.set(keyOf(row.day, row.path, row.referrerHost), { ...row });
  }
}

async function flushVisitCountsOnce(now: number, db: VisitCounterDatabase): Promise<void> {
  const taken = takeVisitCounts();
  try {
    if (taken.length) await db.execute(sql`
      insert into ${postialVisitDaily} (day, path, referrer_host, views, visits)
      values ${sql.join(taken.map(row => sql`(${row.day}::date, ${row.path}, ${row.referrerHost}, ${row.views}::int, ${row.visits}::int)`), sql`, `)}
      on conflict (day, path, referrer_host) do update
        set views = postial_visit_daily.views + excluded.views, visits = postial_visit_daily.visits + excluded.visits
    `);
  } catch (error) {
    restoreVisitCounts(taken, now);
    console.warn('[visit-stats] flush failed:', error instanceof Error ? error.message : error);
  }
  // Retention runs at least hourly while the process lives, with or without new page loads.
  if (now - state.retainedAt >= RETENTION_EVERY_MS) {
    try {
      await db.execute(sql`delete from ${postialVisitDaily} where ${postialVisitDaily.day} < current_date - ${VISIT_STATS_RETENTION_MONTHS}::int * interval '1 month'`);
      state.retainedAt = now;
    } catch (error) {
      console.warn('[visit-stats] retention failed:', error instanceof Error ? error.message : error);
    }
  }
}

export async function flushVisitCounts(now: number = Date.now(), db: VisitCounterDatabase | null = null): Promise<void> {
  state.flushing ??= flushVisitCountsOnce(now, db ?? getDb()).finally(() => { state.flushing = null; });
  await state.flushing;
}

function ensureVisitTimer(): void {
  if (state.timer || !process.env.DATABASE_URL) return;
  state.timer = setInterval(() => { void flushVisitCounts(); }, FLUSH_MS);
  state.timer.unref();
}

/** Synchronous, zero awaits, never throws; the proxy call site wraps it in its own try/catch. */
export function countVisitRequest(req: { method: string; url: string; headers: { get(name: string): string | null } }, now = Date.now()): void {
  if (!process.env.DATABASE_URL) return;
  const hit = classifyVisitRequest(req);
  if (!hit) return;
  addVisitHit(hit, now);
  ensureVisitTimer();
}

/** Report path: flush pending totals first, then read the aggregate table. */
export async function readVisitReport(days: unknown) {
  await flushVisitCounts();
  return visitReport(days);
}
