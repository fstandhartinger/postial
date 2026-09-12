import { and, gte, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { funnelEvents } from '@/db/schema';
import { headers } from 'next/headers';

export const FUNNEL_EVENTS = [
  'landing_view', 'pricing_view', 'docs_view', 'compare_view', 'signup_started',
  'signup_completed', 'signin_failed', 'workspace_created', 'channel_connected', 'post_scheduled',
  'post_published', 'checkout_started', 'subscription_active',
  // Recorded by the browser itself, not during render: a crawler that sends a browser
  // user agent still does not execute JavaScript, so comparing this against landing_view
  // is what turns 'browser' from an upper bound into a measurement.
  'client_ready',
] as const;
export type FunnelEvent = typeof FUNNEL_EVENTS[number];
export const CLIENT_CLASSES = ['browser', 'automated', 'unknown'] as const;
export type ClientClass = typeof CLIENT_CLASSES[number];
export const FUNNEL_SUCCESS_EVENTS = [
  'landing_view', 'pricing_view', 'docs_view', 'compare_view', 'signup_started',
  'signup_completed', 'workspace_created', 'channel_connected', 'post_scheduled',
  'post_published', 'checkout_started', 'subscription_active',
] as const;
export const FUNNEL_FAILURE_EVENTS = ['signin_failed'] as const;
const allowed = new Set<string>(FUNNEL_EVENTS);
const publicViewEvents = new Set(['landing_view', 'pricing_view', 'docs_view', 'compare_view', 'client_ready']);
const automatedUserAgent = /bot|crawler|spider|slurp|headless|preview|curl|wget|python-requests|http-client|monitor|uptime|lighthouse|scanner/i;
// Which search engine, if any, is crawling us. Our only self-directed acquisition channel is
// search, and since cycle 73 there has been no way to tell whether it is being crawled at
// all. This records the engine family only, never the user agent itself, and only for
// programs that identify themselves as crawlers.
const searchEngines: ReadonlyArray<readonly [string, RegExp]> = [
  ['google', /googlebot|google-inspectiontool|storebot-google/i],
  ['bing', /bingbot|adidxbot/i],
  ['duckduckgo', /duckduckbot/i],
  ['yandex', /yandexbot/i],
  ['apple', /applebot/i],
  ['ai', /gptbot|claudebot|perplexitybot|ccbot|bytespider/i],
];
export function searchEngine(userAgent: string | null | undefined): string | undefined {
  if (!userAgent) return undefined;
  return searchEngines.find(([, pattern]) => pattern.test(userAgent))?.[0];
}
let publicViewDay = '';
const publicViewCounts = new Map<string, number>();

function publicViewCap() {
  const configured = Number.parseInt(process.env.FUNNEL_VIEW_DAILY_CAP ?? '50000', 10);
  return Number.isFinite(configured) && configured >= 0 ? configured : 50000;
}

export type FunnelOptions = { workspaceId?: string; path?: string; referrerHost?: string; props?: Record<string, unknown>; clientClass?: ClientClass };

export function classifyUserAgent(userAgent: string | null | undefined): ClientClass {
  if (!userAgent) return 'automated';
  return automatedUserAgent.test(userAgent) ? 'automated' : 'browser';
}

export type SignInMethod = 'google' | 'email' | 'unknown';
export type SignInFailureReason = 'verification' | 'oauth' | 'other';

// Attribute a method only when the error names one. A failure we cannot place stays
// 'unknown': guessing 'email' here would quietly bias every later comparison between
// the two sign-in paths, which is the opposite of what this measurement exists for.
export function signInFailureDetails(error: string | undefined): { method: SignInMethod; reason: SignInFailureReason } {
  const value = (error ?? '').toLowerCase();
  if (value.includes('verification')) return { method: 'email', reason: 'verification' };
  if (value.includes('emailsignin')) return { method: 'email', reason: 'other' };
  if (value.includes('oauth') || value.includes('google')) return { method: 'google', reason: 'oauth' };
  return { method: 'unknown', reason: 'other' };
}

export async function recordFunnelEvent(event: string, options: FunnelOptions = {}): Promise<void> {
  if (!allowed.has(event)) return;
  try {
    const now = new Date();
    if (publicViewEvents.has(event)) {
      const day = now.toISOString().slice(0, 10);
      if (day !== publicViewDay) { publicViewDay = day; publicViewCounts.clear(); }
      const key = `${day}:${event}`, count = publicViewCounts.get(key) ?? 0;
      if (count >= publicViewCap()) return;
      publicViewCounts.set(key, count + 1);
    }
    await getDb().insert(funnelEvents).values({
      event, day: now.toISOString().slice(0, 10), workspaceId: options.workspaceId,
      clientClass: options.clientClass ?? 'unknown', path: options.path?.slice(0, 512), referrerHost: options.referrerHost?.slice(0, 255), props: options.props ?? {},
    });
  } catch { /* Funnel measurement is strictly best effort. */ }
}

export function referrerHost(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  try { return new URL(value).hostname || undefined; } catch { return undefined; }
}
export function recordPublicView(event: FunnelEvent, path: string): void {
  void (async () => {
    try {
      const h = await headers();
      const agent = h.get('user-agent');
      const engine = searchEngine(agent);
      await recordFunnelEvent(event, { path, referrerHost: referrerHost(h.get('referer')),
        clientClass: classifyUserAgent(agent), ...(engine ? { props: { crawler: engine } } : {}) });
    } catch { /* Public rendering must never depend on measurement. */ }
  })();
}

export function conversionRates(counts: Record<string, number>) {
  const stages = ['landing_view', 'signup_started', 'signup_completed', 'workspace_created', 'channel_connected', 'subscription_active'];
  return Object.fromEntries(stages.slice(1).map((event, i) => {
    const previous = counts[stages[i]] ?? 0, current = counts[event] ?? 0;
    return [event, previous ? current / previous : null];
  }));
}

/**
 * Our own hosts. A visit that arrives through postial.net or the www variants is redirected to
 * postial.co, and the hop is recorded as a page view of its own with our host as the referrer.
 * In the twelve hours to 2026-09-12 10:00, 40 of 84 browser-shaped landing views were such hops.
 * Counting them as arrivals overstates reach, so the report separates them instead of hiding
 * them in a referrer list nobody totals up.
 */
export const OWN_REFERRER_HOSTS: readonly string[] = [
  'postial.co', 'www.postial.co', 'postial.net', 'www.postial.net', 'socialmint.app.mintapis.com',
];
export function isOwnReferrer(host: string | null | undefined): boolean {
  const value = host?.trim().toLowerCase();
  if (!value) return false;
  if (OWN_REFERRER_HOSTS.includes(value)) return true;
  // Also the host this instance is actually served from. Without it the list silently misses a
  // new domain, and it counted the verification host as an external arrival: the rendered readout
  // reported localhost among the sites people came from. A hard-coded list cannot know where it
  // runs; the configured app URL can.
  const configured = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL;
  if (!configured) return false;
  try { return new URL(configured).hostname.toLowerCase() === value; } catch { return false; }
}

export async function funnelReport(days: number) {
  const since = new Date(Date.now() - Math.max(1, days) * 86400000).toISOString().slice(0, 10);
  const rows = await getDb().select({ event: funnelEvents.event, day: funnelEvents.day, clientClass: funnelEvents.clientClass, count: sql<number>`count(*)::int` })
    .from(funnelEvents).where(gte(funnelEvents.day, since)).groupBy(funnelEvents.event, funnelEvents.day, funnelEvents.clientClass);
  const refs = await getDb().select({ host: funnelEvents.referrerHost, count: sql<number>`count(*)::int` }).from(funnelEvents)
    .where(and(gte(funnelEvents.day, since), sql`${funnelEvents.referrerHost} is not null`)).groupBy(funnelEvents.referrerHost)
    .orderBy(sql`count(*) desc`).limit(10);
  const clientClassTotals: Record<ClientClass, Record<string, number>> = { browser: {}, automated: {}, unknown: {} };
  const clientClassByDay: Record<ClientClass, Record<string, Record<string, number>>> = { browser: {}, automated: {}, unknown: {} };
  for (const row of rows) {
    const clientClass = CLIENT_CLASSES.includes(row.clientClass as ClientClass) ? row.clientClass as ClientClass : 'unknown';
    clientClassTotals[clientClass][row.event] = (clientClassTotals[clientClass][row.event] ?? 0) + row.count;
    (clientClassByDay[clientClass][row.day] ??= {})[row.event] = row.count;
  }
  const totals = clientClassTotals.browser;
  const byDay = clientClassByDay.browser;
  const workspaceRows = await getDb().select({ event: funnelEvents.event, count: sql<number>`count(distinct ${funnelEvents.workspaceId})::int` })
    .from(funnelEvents).where(and(gte(funnelEvents.day, since), sql`${funnelEvents.workspaceId} is not null`)).groupBy(funnelEvents.event);
  const workspaceTotals: Record<string, number> = {};
  for (const row of workspaceRows) workspaceTotals[row.event] = row.count;
  const workspaceStages = ['workspace_created', 'channel_connected', 'subscription_active'];
  const workspaceConversions = Object.fromEntries(workspaceStages.slice(1).map((event, i) => {
    const previous = workspaceTotals[workspaceStages[i]] ?? 0, current = workspaceTotals[event] ?? 0;
    return [event, previous ? current / previous : null];
  }));
  const ownReferralViews = refs.filter(row => isOwnReferrer(row.host)).reduce((sum, row) => sum + row.count, 0);
  const externalReferralViews = refs.filter(row => !isOwnReferrer(row.host)).reduce((sum, row) => sum + row.count, 0);
  return { days, since, ownReferralViews, externalReferralViews, totals, byDay, clientClassTotals, clientClassByDay, conversions: conversionRates(totals), eventConversions: conversionRates(totals), workspaceTotals, workspaceConversions, topReferrers: refs.map(r => ({ host: r.host, count: r.count })) };
}

export function adminEmails(): string[] { return (process.env.ADMIN_EMAILS ?? '').split(',').map(v => v.trim().toLowerCase()).filter(Boolean); }
export function isAdminEmail(email: string | null | undefined): boolean { return Boolean(email && adminEmails().includes(email.trim().toLowerCase())); }
