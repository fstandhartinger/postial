import { sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { postialVisitDaily } from '@/db/schema';
import { VISIT_REPORT_MIN_COUNT } from '@/lib/visit-stats';

type ReportAggregate = { date: string; page: string; referrer: string; views: number; visits: number };
type ReportDatabase = Pick<ReturnType<typeof getDb>, 'execute'>;

export function normalizeVisitDays(value: unknown): number {
  if ((typeof value !== 'string' && typeof value !== 'number') || (typeof value === 'string' && !value.trim())) return 30;
  const days = Number(value);
  return Number.isFinite(days) ? Math.min(90, Math.max(1, Math.floor(days))) : 30;
}

/** Rank by views; keep rows with at least VISIT_REPORT_MIN_COUNT views up to 25 named rows and conserve the rest in one (other) row. */
function foldByName(rows: Map<string, number>): { name: string; views: number }[] {
  const sorted = [...rows.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const named = sorted.filter(([, views]) => views >= VISIT_REPORT_MIN_COUNT).slice(0, 25).map(([name, views]) => ({ name, views }));
  const namedSet = new Set(named.map(row => row.name));
  const rest = sorted.filter(([name]) => !namedSet.has(name));
  if (!rest.length) return named;
  return [...named, { name: '(other)', views: rest.reduce((sum, [, views]) => sum + views, 0) }];
}

export async function visitReport(value: unknown = 30, db: ReportDatabase = getDb(), now = new Date()) {
  const count = normalizeVisitDays(value);
  const today = now.toISOString().slice(0, 10);
  const midnight = Date.parse(`${today}T00:00:00.000Z`);
  const dates = Array.from({ length: count }, (_, index) => new Date(midnight - (count - index - 1) * 86400000).toISOString().slice(0, 10));
  const referrer = sql`case ${postialVisitDaily.referrerHost} when '' then '(direct)' else ${postialVisitDaily.referrerHost} end`;
  const rows = await db.execute<ReportAggregate>(sql`
    select ${postialVisitDaily.day}::text as date,
      ${postialVisitDaily.path} as page,
      ${referrer} as referrer,
      sum(${postialVisitDaily.views})::integer as views,
      sum(${postialVisitDaily.visits})::integer as visits
    from ${postialVisitDaily}
    where ${postialVisitDaily.day} >= ${dates[0]}::date and ${postialVisitDaily.day} <= ${today}::date
    group by 1, 2, 3
  `);
  const daily = new Map(dates.map(date => [date, { views: 0, visits: 0 }]));
  const pageViews = new Map<string, number>();
  const referrerViews = new Map<string, number>();
  for (const row of rows) {
    const day = daily.get(row.date);
    if (day) { day.views += row.views; day.visits += row.visits; }
    pageViews.set(row.page, (pageViews.get(row.page) ?? 0) + row.views);
    referrerViews.set(row.referrer, (referrerViews.get(row.referrer) ?? 0) + row.views);
  }
  const [countingFrom] = await db.execute<{ day: string | null }>(sql`select min(${postialVisitDaily.day})::text as day from ${postialVisitDaily}`);
  return {
    days: dates.map(date => {
      const day = daily.get(date) ?? { views: 0, visits: 0 };
      return { date, views: day.views, visits: day.visits, uniques: null };
    }),
    topPages: foldByName(pageViews).map(({ name, views }) => ({ page: name, views })),
    topReferrers: foldByName(referrerViews).map(({ name, views }) => ({ referrer: name, views })),
    coverage: {
      pages: 'Known public route shapes (/ plus pricing, docs, compare, privacy, terms, impressum, legal, roadmap, join, login, app, m and r) truncated to 3 path segments; every other path is stored and reported as one (unknown route) row.',
      mechanism: 'Full HTML document loads reaching the application server; requests with prefetch/prerender signals, a non-document fetch destination, a bot user agent, a Global Privacy Control or Do Not Track signal, or an internal marker are never counted.',
      countingFrom: countingFrom?.day ?? null,
      limitations: [
        'RSC client navigations and prefetches are not visible to the server counter and are not counted; the beacon funnel records selected views separately and counts conversions, not visitors.',
        'Page loads served from a downstream cache never reach the application server and are not seen.',
        'The browser filter is a heuristic, not verified humans; automated, internal and unknown-classified requests are excluded.',
        'Visits are page loads without a same-site referrer, not sessions; reloads inflate views and visits alike.',
      ],
    },
    definitions: {
      views: 'Count of stored full-page document loads per day and route shape, not people or sessions.',
      visits: 'Count of stored page loads without a same-site referrer (arrivals from outside), not sessions.',
      uniques: 'Unavailable: no distinct-person identifier is used or inferred, by the consent decision in docs/visitor-statistics-consent.md.',
      days: 'Exactly the requested UTC calendar days, today inclusive and zero-filled, excluding future days; default 30, clamped 1–90.',
      topPages: 'Stored route-shape paths ranked by views; named rows need at least 3 views in the requested window, everything else is conserved in one (other) row.',
      topReferrers: 'Referring host names with (direct) for loads without a referrer; ranked by views; named rows need at least 3 views, everything else is conserved in one (other) row.',
    },
  };
}

type HandlerDependencies = {
  auth: () => Promise<{ user?: { email?: string | null } } | null>;
  isAdminEmail: (email: string | null | undefined) => boolean;
  report: (days: number) => Promise<unknown>;
};

export function createVisitHandler({ auth, isAdminEmail, report }: HandlerDependencies) {
  return async function handler(request: Request): Promise<Response> {
    const headers = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' };
    try {
      const session = await auth();
      if (!isAdminEmail(session?.user?.email) || request.method !== 'GET') return new Response(null, { status: 404, headers });
      const days = normalizeVisitDays(new URL(request.url).searchParams.get('days'));
      return Response.json(await report(days), { headers });
    } catch {
      return Response.json({ error: 'Service unavailable' }, { status: 503, headers });
    }
  };
}
