import { sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { funnelEvents } from '@/db/schema';
import { OWN_REFERRER_HOSTS } from '@/lib/funnel';

const publicHosts = ['google.com', 'www.google.com', 'bing.com', 'www.bing.com', 'duckduckgo.com', 'www.duckduckgo.com', 'news.ycombinator.com', 'reddit.com', 'www.reddit.com', 'linkedin.com', 'www.linkedin.com', 't.co'] as const;
const pages = ['/', '/pricing', '/docs', '/compare'] as const;
type Page = typeof pages[number];
type Aggregate = { date: string; page: Page; referrer: string; views: number };
type ReportDatabase = Pick<ReturnType<typeof getDb>, 'execute'>;

export function normalizeVisitDays(value: unknown): number {
  if ((typeof value !== 'string' && typeof value !== 'number') || (typeof value === 'string' && !value.trim())) return 30;
  const days = Number(value);
  return Number.isFinite(days) ? Math.min(90, Math.max(1, Math.floor(days))) : 30;
}

export async function visitReport(value: unknown = 30, db: ReportDatabase = getDb(), now = new Date()) {
  const count = normalizeVisitDays(value);
  const today = now.toISOString().slice(0, 10);
  const midnight = Date.parse(`${today}T00:00:00.000Z`);
  const dates = Array.from({ length: count }, (_, index) => new Date(midnight - (count - index - 1) * 86400000).toISOString().slice(0, 10));
  const host = sql`lower(btrim(${funnelEvents.referrerHost}))`;
  const rows = await db.execute<Aggregate>(sql`
    select ${funnelEvents.day}::text as date,
      case ${funnelEvents.event}
        when 'landing_view' then '/'
        when 'pricing_view' then '/pricing'
        when 'docs_view' then '/docs'
        when 'compare_view' then '/compare'
      end as page,
      case
        when ${host} is null or ${host} = '' then '(direct)'
        when ${host} in (${sql.join(OWN_REFERRER_HOSTS.map(value => sql`${value}`), sql`, `)}) then '(own)'
        when ${host} in (${sql.join(publicHosts.map(value => sql`${value}`), sql`, `)}) then ${host}
        else '(other)'
      end as referrer,
      count(*)::integer as views
    from ${funnelEvents}
    where ${funnelEvents.clientClass} = 'browser'
      and ${funnelEvents.event} in ('landing_view', 'pricing_view', 'docs_view', 'compare_view')
      and ${funnelEvents.day} >= ${dates[0]}::date
      and ${funnelEvents.day} <= ${today}::date
      and ${funnelEvents.occurredAt} <= ${now.toISOString()}::timestamptz
    group by 1, 2, 3
  `);
  const daily = new Map(dates.map(date => [date, 0]));
  const pageCounts = new Map<Page, number>(pages.map(page => [page, 0]));
  const referrers = new Map<string, number>();
  for (const row of rows) {
    daily.set(row.date, (daily.get(row.date) ?? 0) + row.views);
    pageCounts.set(row.page, (pageCounts.get(row.page) ?? 0) + row.views);
    referrers.set(row.referrer, (referrers.get(row.referrer) ?? 0) + row.views);
  }
  for (const host of publicHosts) {
    const views = referrers.get(host) ?? 0;
    if (views > 0 && views < 3) {
      referrers.set('(other)', (referrers.get('(other)') ?? 0) + views);
      referrers.delete(host);
    }
  }
  return {
    days: dates.map(date => ({ date, views: daily.get(date) ?? 0, visits: null, uniques: null })),
    topPages: [...pageCounts].map(([page, views]) => ({ page, views })).sort((a, b) => b.views - a.views || a.page.localeCompare(b.page)),
    topReferrers: [...referrers].map(([referrer, views]) => ({ referrer, views })).sort((a, b) => b.views - a.views || a.referrer.localeCompare(b.referrer)),
    coverage: {
      pages: [...pages],
      clientClass: 'browser',
      limitations: [
        'Only existing landing/pricing/docs/compare server view events; incomplete public route coverage, not the entire app.',
        'Browser classification is heuristic, not verified humans; automated, internal and unknown classes are excluded.',
        'Client navigations, repeated rendering and prefetch may inflate views; collection is best effort.',
      ],
    },
    definitions: {
      views: 'Count of existing browser-class landing_view, pricing_view, docs_view and compare_view events, not people or sessions.',
      visits: 'Unavailable: arrival counts cannot be reconstructed unambiguously from existing events; views are not sessions.',
      uniques: 'Unavailable: no distinct-person identifier is used or inferred.',
      days: 'Exactly the requested UTC calendar days, today inclusive and zero-filled, excluding future event dates and timestamps; default 30, clamped 1–90.',
      topPages: 'Fixed categories derived from event type; stored paths are ignored.',
      topReferrers: 'Fixed public-host allowlist or (direct)/(own)/(other); named hosts with fewer than 3 views across the requested window fold into (other), conserving counts.',
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
