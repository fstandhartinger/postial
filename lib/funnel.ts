import { createHmac, timingSafeEqual } from 'node:crypto';
import { and, gte, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { funnelEvents } from '@/db/schema';
import { headers } from 'next/headers';

export const FUNNEL_EVENTS = [
  'landing_view', 'pricing_view', 'docs_view', 'compare_view', 'signup_started',
  'signup_completed', 'signin_failed', 'workspace_created', 'channel_connected', 'post_scheduled',
  'post_published', 'checkout_started', 'subscription_active',
  // Billing transitions that carry their own meaning: subscription_active is the legacy
  // first-entry-into-trial-or-paid marker, while trial_started and subscription_paid
  // separate a trial start from the moment a workspace actually begins paying.
  'trial_started', 'subscription_paid',
  // Recorded by the browser itself, not during render: a crawler that sends a browser
  // user agent still does not execute JavaScript, so comparing this against landing_view
  // is what turns 'browser' from an upper bound into a measurement.
  'client_ready',
] as const;
export type FunnelEvent = typeof FUNNEL_EVENTS[number];
export const CLIENT_CLASSES = ['browser', 'automated', 'internal', 'unknown', 'system'] as const;
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

export function internalMarkerValue(): string | undefined {
  const token = process.env.FUNNEL_INTERNAL_TOKEN;
  if (!token || token.length < 16) return undefined;
  return createHmac('sha256', token).update('postial-internal-v1').digest('hex');
}

function safeEqual(left: string | null | undefined, right: string | null | undefined): boolean {
  if (!left || !right || Buffer.byteLength(left) !== Buffer.byteLength(right)) return false;
  return timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

function cookieValue(headers: Headers, name: string): string | undefined {
  const cookie = headers.get('cookie');
  if (!cookie) return undefined;
  for (const part of cookie.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1);
  }
  return undefined;
}

export function isInternalRequest(headers: Headers): boolean {
  const token = process.env.FUNNEL_INTERNAL_TOKEN;
  const marker = internalMarkerValue();
  if (!token || !marker) return false;
  return safeEqual(headers.get('x-postial-internal'), token)
    || safeEqual(cookieValue(headers, 'pm_internal'), marker);
}

export function classifyRequest(headers: Headers): ClientClass {
  return isInternalRequest(headers) ? 'internal' : classifyUserAgent(headers.get('user-agent'));
}

/**
 * Class for a funnel event recorded during a request. Falls back to 'system' outside any
 * request scope so background callers never fail: measurement stays strictly best effort.
 */
export async function requestClientClass(): Promise<ClientClass> {
  try { return classifyRequest(await headers()); } catch { return 'system'; }
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
        clientClass: classifyRequest(h), ...(engine ? { props: { crawler: engine } } : {}) });
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
  const clientClassTotals: Record<ClientClass, Record<string, number>> = { browser: {}, automated: {}, internal: {}, unknown: {}, system: {} };
  const clientClassByDay: Record<ClientClass, Record<string, Record<string, number>>> = { browser: {}, automated: {}, internal: {}, unknown: {}, system: {} };
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
  // Registrations as people saw them: account stages counted from the browser class only,
  // so staff, agents and pre-attribution rows (unknown) never inflate these numbers.
  const accountStages = ['signup_started', 'signup_completed', 'workspace_created', 'channel_connected', 'post_scheduled', 'post_published'] as const;
  const accountTotals = Object.fromEntries(accountStages.map(event => [event, totals[event] ?? 0]));
  // Billing events come from two honest sources: a real browser request starting checkout,
  // and the system itself (worker, Stripe webhook). Old rows carry unknown and are shown as
  // unknown, never silently counted as people; internal staff and automated clients are
  // excluded on purpose.
  const billingStages = ['checkout_started', 'trial_started', 'subscription_paid', 'subscription_active'] as const;
  const billingTotals = Object.fromEntries(billingStages.map(event => [event, (totals[event] ?? 0) + (clientClassTotals.system[event] ?? 0)]));
  // Paying conversion over distinct workspaces, like the class-agnostic workspace block:
  // workspace_created -> trial_started -> subscription_paid. null means the denominator
  // stage had no workspaces yet; it is never 0 and never NaN. past_due -> active is a
  // recovered payment and deliberately not a conversion, so it has no stage here.
  const billingWorkspaceStages = ['workspace_created', 'trial_started', 'subscription_paid'] as const;
  const billingConversions = Object.fromEntries(billingWorkspaceStages.slice(1).map((event, i) => {
    const previous = workspaceTotals[billingWorkspaceStages[i]] ?? 0, current = workspaceTotals[event] ?? 0;
    return [event, previous ? current / previous : null];
  }));
  // First day account and billing events carry a real client class. Everything before it
  // was recorded without a class (unknown); the readout must show that break honestly.
  const attributedDays = rows.filter(row => !publicViewEvents.has(row.event)
    && row.clientClass !== 'unknown' && CLIENT_CLASSES.includes(row.clientClass as ClientClass)).map(row => row.day).sort();
  const classAttributionFrom = attributedDays.length ? attributedDays[0] : null;
  const definitions = {
    accountTotals: 'Registrations: account stages counted only from real browser requests (client class browser). Older rows carry unknown and are not counted as people.',
    billingTotals: 'Checkout, trial and subscription events counted from real browser requests and from system processing (browser + system) together; internal staff and automated clients are excluded.',
    billingConversions: 'Share of distinct workspaces moving workspace_created -> trial_started -> subscription_paid; null means the denominator stage had no workspaces yet.',
    trial_started: 'A subscription entered the trialing state: a trial started. This alone is not a paying conversion.',
    subscription_paid: 'A subscription moved to active from trialing or a fresh start: the workspace began paying. past_due -> active is a recovered payment and is not counted.',
    subscription_active: 'Legacy marker: first entry into trial-or-paid. It records a trial start and a paid start alike, so it is not a paid conversion on its own.',
    pastDueRecovery: 'past_due -> active is a recovered payment: the card came back, no new customer decision happened, so it is deliberately not counted as a conversion.',
    classAttributionFrom: `First day on which account and billing events carry a real client class: ${classAttributionFrom ?? 'none yet'}. Rows before that day carry unknown and are shown as unknown, never counted as people.`,
  };
  const ownReferralViews = refs.filter(row => isOwnReferrer(row.host)).reduce((sum, row) => sum + row.count, 0);
  const externalReferralViews = refs.filter(row => !isOwnReferrer(row.host)).reduce((sum, row) => sum + row.count, 0);
  return { days, since, ownReferralViews, externalReferralViews, totals, byDay, clientClassTotals, clientClassByDay, conversions: conversionRates(totals), eventConversions: conversionRates(totals), workspaceTotals, workspaceConversions, accountTotals, billingTotals, billingConversions, classAttributionFrom, definitions, topReferrers: refs.map(r => ({ host: r.host, count: r.count })) };
}

export function adminEmails(): string[] { return (process.env.ADMIN_EMAILS ?? '').split(',').map(v => v.trim().toLowerCase()).filter(Boolean); }
export function isAdminEmail(email: string | null | undefined): boolean { return Boolean(email && adminEmails().includes(email.trim().toLowerCase())); }
