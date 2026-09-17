import { and, asc, eq, gte, inArray, isNotNull, lte, max, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { channelProvider, channels, postMetrics, postTargets } from '@/db/schema';
import { decryptCredentials } from '@/lib/crypto';
import { withAbortSignal } from '@/lib/publishers/http';
import { getPublisher, PublishError, type Credentials, type PostMetrics, type Publisher } from '@/lib/publishers';

/** Only posts published within this window are refreshed; older ones are settled. */
export const METRICS_WINDOW_DAYS = 30;
/** Hard cap on provider calls per tick so a backlog can never stall the worker. */
export const METRICS_PER_TICK = 20;
/** Wall-clock budget per tick: a slow provider must not hold up the next publishing tick. */
export const METRICS_TICK_BUDGET_MS = 15_000;
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
export async function fetchTargetMetrics(publisher: Publisher, credentials: Credentials, remoteId: string, budgetMs?: number): Promise<TargetMetricsFetch> {
  if (!publisher.fetchMetrics) return { outcome: 'unsupported', metrics: null };
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    if (budgetMs !== undefined) {
      if (budgetMs <= 0) return { outcome: 'provider_error', metrics: null };
      timer = setTimeout(() => controller.abort(), budgetMs);
    }
    const metrics = await withAbortSignal(() => publisher.fetchMetrics!(credentials, remoteId, controller.signal), controller.signal);
    return { outcome: 'ok', metrics };
  } catch (error) {
    return { outcome: metricsOutcome(publisher, null, error), metrics: null };
  } finally { clearTimeout(timer); }
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
  const latest = db
    .select({ targetId: postMetrics.targetId, fetchedAt: max(postMetrics.fetchedAt).as('fetched_at') })
    .from(postMetrics)
    .groupBy(postMetrics.targetId)
    .as('latest_metrics');
  const interval = sql`case
    when ${postTargets.publishedAt} > ${new Date(now.getTime() - 24 * 3_600_000).toISOString()}::timestamptz then interval '1 hour'
    when ${postTargets.publishedAt} > ${new Date(now.getTime() - 7 * 24 * 3_600_000).toISOString()}::timestamptz then interval '6 hours'
    else interval '24 hours' end`;
  const dueAt = sql`coalesce(${latest.fetchedAt} + ${interval}, ${postTargets.publishedAt})`;
  const candidates = await db
    .select({
      targetId: postTargets.id,
      remoteId: postTargets.remoteId,
      publishedAt: postTargets.publishedAt,
      provider: channels.provider,
      credentialsEnc: channels.credentialsEnc,
      fetchedAt: latest.fetchedAt,
    })
    .from(postTargets)
    .innerJoin(channels, eq(channels.id, postTargets.channelId))
    .leftJoin(latest, eq(latest.targetId, postTargets.id))
    .where(
      and(
        eq(postTargets.status, 'published'),
        isNotNull(postTargets.remoteId),
        gte(postTargets.publishedAt, windowStart),
        lte(postTargets.publishedAt, now),
        inArray(channels.provider, measurable),
        lte(dueAt, now.toISOString()),
      ),
    )
    .orderBy(sql`${latest.fetchedAt} asc nulls first`, asc(dueAt), asc(postTargets.id))
    .limit(METRICS_CANDIDATE_LIMIT);
  if (!candidates.length) return 0;
  let refreshed = 0;
  for (const candidate of candidates) {
    if (refreshed >= METRICS_PER_TICK || Date.now() - started >= budgetMs) break;
    if (!candidate.remoteId || !candidate.publishedAt) continue;
    const last = candidate.fetchedAt ? new Date(candidate.fetchedAt) : null;
    const intervalMs = metricsRefreshIntervalMs(candidate.publishedAt, now);
    if (last && now.getTime() - last.getTime() < intervalMs) continue;
    refreshed += 1;
    try {
      let result: TargetMetricsFetch = { outcome: 'provider_error', metrics: null };
      try {
        const publisher = getPublisher(candidate.provider);
        const credentials = decryptCredentials(candidate.credentialsEnc);
        result = await fetchTargetMetrics(publisher, credentials, candidate.remoteId, budgetMs - (Date.now() - started));
      } catch {}
      const { outcome, metrics } = result;
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
