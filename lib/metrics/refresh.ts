import { and, desc, eq, gte, inArray, isNotNull, lte, max } from 'drizzle-orm';
import { getDb } from '@/db';
import { channelProvider, channels, postMetrics, postTargets } from '@/db/schema';
import { decryptCredentials } from '@/lib/crypto';
import { getPublisher, PublishError, type Credentials, type PostMetrics, type Publisher } from '@/lib/publishers';

/** Only posts published within this window are refreshed; older ones are settled. */
export const METRICS_WINDOW_DAYS = 30;
/** Hard cap on provider calls per tick so a backlog can never stall the worker. */
export const METRICS_PER_TICK = 20;
/** Wall-clock budget per tick: a slow provider must not hold up the next publishing tick. */
export const METRICS_TICK_BUDGET_MS = 15_000;
/** Upper bound on targets considered per tick (published in the window, newest first). */
export const METRICS_CANDIDATE_LIMIT = 500;

export type MetricOutcomeValue = 'ok' | 'unsupported' | 'auth_expired' | 'provider_error';

export interface TargetMetricsFetch {
  outcome: MetricOutcomeValue;
  metrics: PostMetrics | null;
}

/**
 * Maps the adapter contract to the stored outcome. A missing fetchMetrics is
 * the first-class "unsupported" state; AUTH_EXPIRED is recorded, never fatal.
 */
export function metricsOutcome(publisher: Publisher, metrics: PostMetrics | null, error: unknown): MetricOutcomeValue {
  if (!publisher.fetchMetrics) return 'unsupported';
  if (metrics) return 'ok';
  if (error instanceof PublishError && error.code === 'AUTH_EXPIRED') return 'auth_expired';
  return 'provider_error';
}

/** Fetches one target's metrics and maps every failure to a stored outcome. Never throws. */
export async function fetchTargetMetrics(publisher: Publisher, credentials: Credentials, remoteId: string): Promise<TargetMetricsFetch> {
  if (!publisher.fetchMetrics) return { outcome: 'unsupported', metrics: null };
  try {
    return { outcome: 'ok', metrics: await publisher.fetchMetrics(credentials, remoteId) };
  } catch (error) {
    return { outcome: metricsOutcome(publisher, null, error), metrics: null };
  }
}

/** Backoff between refreshes: fresh posts are polled often, old posts rarely. */
export function metricsRefreshIntervalMs(publishedAt: Date, now: Date): number {
  const ageMs = Math.max(0, now.getTime() - publishedAt.getTime());
  if (ageMs < 24 * 3_600_000) return 3_600_000;
  if (ageMs < 7 * 24 * 3_600_000) return 6 * 3_600_000;
  return 24 * 3_600_000;
}

type Db = ReturnType<typeof getDb>;

/**
 * Refreshes metrics for published targets. Gentle and bounded: 30-day window,
 * per-tick cap, age-based backoff, and every failure is contained — a metrics
 * problem must never affect publishing or throw out of the tick.
 */
export async function refreshMetricsTick(db: Db = getDb(), budgetMs: number = METRICS_TICK_BUDGET_MS): Promise<number> {
  const now = new Date();
  const started = Date.now();
  const windowStart = new Date(now.getTime() - METRICS_WINDOW_DAYS * 24 * 3_600_000);
  // Only networks whose adapter can report metrics are candidates. Filtering here (not
  // after the query) keeps targets that can never be measured, such as Telegram, from
  // filling the candidate list and starving posts that can.
  const measurable = channelProvider.enumValues.filter(provider => Boolean(getPublisher(provider).fetchMetrics));
  if (!measurable.length) return 0;
  const candidates = await db
    .select({
      targetId: postTargets.id,
      remoteId: postTargets.remoteId,
      publishedAt: postTargets.publishedAt,
      provider: channels.provider,
      credentialsEnc: channels.credentialsEnc,
    })
    .from(postTargets)
    .innerJoin(channels, eq(channels.id, postTargets.channelId))
    .where(
      and(
        eq(postTargets.status, 'published'),
        isNotNull(postTargets.remoteId),
        gte(postTargets.publishedAt, windowStart),
        lte(postTargets.publishedAt, now),
        inArray(channels.provider, measurable),
      ),
    )
    // Newest first: fresh posts change fastest and have the shortest backoff.
    .orderBy(desc(postTargets.publishedAt))
    .limit(METRICS_CANDIDATE_LIMIT);
  if (!candidates.length) return 0;
  const latestRows = await db
    .select({ targetId: postMetrics.targetId, fetchedAt: max(postMetrics.fetchedAt) })
    .from(postMetrics)
    .where(inArray(postMetrics.targetId, candidates.map(c => c.targetId)))
    .groupBy(postMetrics.targetId);
  const latest = new Map<string, Date>();
  for (const row of latestRows) if (row.fetchedAt) latest.set(row.targetId, new Date(row.fetchedAt));
  let refreshed = 0;
  for (const candidate of candidates) {
    if (refreshed >= METRICS_PER_TICK || Date.now() - started >= budgetMs) break;
    if (!candidate.remoteId || !candidate.publishedAt) continue;
    const last = latest.get(candidate.targetId);
    const intervalMs = metricsRefreshIntervalMs(candidate.publishedAt, now);
    if (last && now.getTime() - last.getTime() < intervalMs) continue;
    refreshed += 1;
    try {
      const publisher = getPublisher(candidate.provider);
      const { outcome, metrics } = await fetchTargetMetrics(publisher, decryptCredentials(candidate.credentialsEnc), candidate.remoteId);
      await db.insert(postMetrics).values({
        targetId: candidate.targetId,
        provider: candidate.provider,
        fetchedAt: now,
        outcome,
        likes: metrics?.likes ?? null,
        replies: metrics?.replies ?? null,
        reposts: metrics?.reposts ?? null,
        quotes: metrics?.quotes ?? null,
        impressions: metrics?.impressions ?? null,
      });
    } catch {
      // A metrics failure must never affect publishing or throw out of the tick.
    }
  }
  return refreshed;
}
