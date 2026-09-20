import { isInternalRequest, isOwnReferrer } from '@/lib/funnel';

// First-party, aggregate-only visitor statistics (decision record: docs/visitor-statistics-consent.md).
// The server counts the page requests it delivers anyway. Nothing is written to or read from the
// visitor's device (no cookie, storage, script, pixel or client hint), no identifier is derived
// (no IP, no hash, no fingerprint), and only daily totals per route shape and referring host are
// stored. Unique visitors are therefore not measured; "visits" counts page loads that entered the
// site from outside (no same-site referrer). Only full page loads are seen: in-app RSC
// navigations and prefetches carry a non-document fetch destination and are not counted.

export const VISIT_STATS_RETENTION_MONTHS = 13;
/** The operator report never shows a page or referrer row with fewer page loads than this (no single-visit facts). */
export const VISIT_REPORT_MIN_COUNT = 3;
/** Distinct daily rows held in memory while pending flush; further new rows are skipped. */
export const VISIT_STATS_MAX_KEYS = 5000;

export interface VisitHit { path: string; referrerHost: string; visit: boolean }

// The user agent is read only for this test and never stored.
const botUserAgent = /bot|crawl|spider|slurp|preview|fetch|scan|monitor|lighthouse|headless|phantom|playwright|puppeteer|selenium|curl|wget|python|httpx|axios|node-fetch|undici|go-http|java\/|okhttp|libwww|facebookexternalhit|embedly|quora|whatsapp|telegram|discord|skype|vkshare|w3c_validator|pingdom|uptime|gptbot|chatgpt|claude|anthropic|perplexity|bytespider|ccbot|amazonbot|applebot|bingpreview/i;

// Only known page routes are recorded; anything else (scanners, typos) is stored as one "(unknown route)" row.
const knownFirstSegments = new Set(['', 'pricing', 'docs', 'compare', 'privacy', 'terms', 'impressum', 'legal', 'roadmap', 'join', 'login', 'app', 'm', 'r']);
const unknownRouteLabel = '(unknown route)';

function referrerHostOf(value: string): string | null {
  try { return new URL(value).hostname.toLowerCase().replace(/^www\./, '') || null; } catch { return null; }
}

/** Page path without query or fragment, truncated to its route shape; null for non-page requests. */
function normalizeVisitPath(pathname: string): string | null {
  if (!pathname.startsWith('/')) return null;
  if (pathname.startsWith('/_next') || pathname.startsWith('/api') || pathname.startsWith('/healthz') || /\.[a-z0-9]{2,5}$/i.test(pathname)) return null;
  let clean = pathname.replace(/\/{2,}/g, '/');
  if (clean.length > 1) clean = clean.replace(/\/$/, '');
  const parts = clean.split('/').slice(1);
  if (!knownFirstSegments.has(parts[0] ?? '')) return unknownRouteLabel;
  return ('/' + parts.slice(0, 3).join('/')).slice(0, 160);
}

/**
 * Decide whether one incoming request is a page view to count. Never reads an IP header,
 * never reads or sets cookies for statistics (only the internal-marker check) and never
 * touches auth or session state.
 * @param {{ method: string, url: string, headers: { get(name: string): string | null } }} req
 * @returns {VisitHit | null}
 */
export function classifyVisitRequest(req: { method: string; url: string; headers: { get(name: string): string | null } }): VisitHit | null {
  if (req.method !== 'GET') return null;
  const h = req.headers;
  // Objection signals the browser already sends: Global Privacy Control and Do Not Track.
  if (h.get('sec-gpc') === '1' || h.get('dnt') === '1') return null;
  // Browser prefetch/prerender of a document is not a view.
  if (/prefetch|prerender/i.test(`${h.get('sec-purpose') ?? ''} ${h.get('purpose') ?? ''}`)) return null;
  const dest = h.get('sec-fetch-dest');
  if (dest ? dest !== 'document' : !(h.get('accept') ?? '').includes('text/html')) return null;
  if (isInternalRequest(h as Headers)) return null;
  const ua = h.get('user-agent') ?? '';
  if (!ua || botUserAgent.test(ua)) return null;
  let pathname: string;
  try { pathname = new URL(req.url).pathname; } catch { return null; }
  const path = normalizeVisitPath(pathname);
  if (!path) return null;
  const ref = h.get('referer');
  const refHost = ref ? referrerHostOf(ref) : null;
  // Same-site as funnel's own-host list plus the configured app host, and the local
  // development hosts from the Benchmark Heaven reference: none of them counts as an arrival.
  const sameSite = refHost !== null && (isOwnReferrer(refHost) || refHost === 'localhost' || refHost === '127.0.0.1');
  return {
    path,
    referrerHost: refHost && !sameSite ? refHost.slice(0, 100) : '',
    visit: !sameSite,
  };
}
