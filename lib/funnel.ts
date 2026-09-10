import { and, eq, gte, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { funnelEvents } from '@/db/schema';
import { headers } from 'next/headers';

export const FUNNEL_EVENTS = [
  'landing_view', 'pricing_view', 'docs_view', 'compare_view', 'signup_started',
  'signup_completed', 'workspace_created', 'channel_connected', 'post_scheduled',
  'post_published', 'checkout_started', 'subscription_active',
] as const;
export type FunnelEvent = typeof FUNNEL_EVENTS[number];
const allowed = new Set<string>(FUNNEL_EVENTS);

export type FunnelOptions = { workspaceId?: string; path?: string; referrerHost?: string; props?: Record<string, unknown> };

export async function recordFunnelEvent(event: string, options: FunnelOptions = {}): Promise<void> {
  if (!allowed.has(event)) return;
  try {
    const now = new Date();
    await getDb().insert(funnelEvents).values({
      event, day: now.toISOString().slice(0, 10), workspaceId: options.workspaceId,
      path: options.path?.slice(0, 512), referrerHost: options.referrerHost?.slice(0, 255), props: options.props ?? {},
    });
  } catch { /* Funnel measurement is strictly best effort. */ }
}

export function referrerHost(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  try { return new URL(value).hostname || undefined; } catch { return undefined; }
}
export async function recordPublicView(event: FunnelEvent, path: string) {
  const h = await headers();
  await recordFunnelEvent(event, { path, referrerHost: referrerHost(h.get('referer')) });
}

export function conversionRates(counts: Record<string, number>) {
  const stages = ['landing_view', 'signup_started', 'signup_completed', 'workspace_created', 'channel_connected', 'subscription_active'];
  return Object.fromEntries(stages.slice(1).map((event, i) => {
    const previous = counts[stages[i]] ?? 0, current = counts[event] ?? 0;
    return [event, previous ? current / previous : 0];
  }));
}

export async function funnelReport(days: number) {
  const since = new Date(Date.now() - Math.max(1, days) * 86400000).toISOString().slice(0, 10);
  const rows = await getDb().select({ event: funnelEvents.event, day: funnelEvents.day, count: sql<number>`count(*)::int` })
    .from(funnelEvents).where(gte(funnelEvents.day, since)).groupBy(funnelEvents.event, funnelEvents.day);
  const refs = await getDb().select({ host: funnelEvents.referrerHost, count: sql<number>`count(*)::int` }).from(funnelEvents)
    .where(and(gte(funnelEvents.day, since), sql`${funnelEvents.referrerHost} is not null`)).groupBy(funnelEvents.referrerHost)
    .orderBy(sql`count(*) desc`).limit(10);
  const totals: Record<string, number> = {}, byDay: Record<string, Record<string, number>> = {};
  for (const row of rows) { totals[row.event] = (totals[row.event] ?? 0) + row.count; (byDay[row.day] ??= {})[row.event] = row.count; }
  return { days, since, totals, byDay, conversions: conversionRates(totals), topReferrers: refs.map(r => ({ host: r.host, count: r.count })) };
}

export function adminEmails(): string[] { return (process.env.ADMIN_EMAILS ?? '').split(',').map(v => v.trim().toLowerCase()).filter(Boolean); }
export function isAdminEmail(email: string | null | undefined): boolean { return Boolean(email && adminEmails().includes(email.trim().toLowerCase())); }
