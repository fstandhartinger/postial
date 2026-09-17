/**
 * AN-3 previous-period comparison. Pure and deterministic: it only ever
 * combines provider-reported numbers. A metric that is missing (null) on
 * either side yields no delta for that metric — never a fabricated 0 or 0 %.
 */
export type MetricKey = 'likes' | 'replies' | 'reposts' | 'quotes' | 'impressions';
export const METRIC_KEYS: MetricKey[] = ['likes', 'replies', 'reposts', 'quotes', 'impressions'];

export interface MetricPoint {
  fetchedAt: Date;
  values: Record<MetricKey, number | null>;
}

export interface MetricsComparison {
  /** no_data: no measurements at all. no_previous: nothing measured in the
   *  previous period (or in the current one), so no delta can be computed.
   *  compared: both periods have data and at least one real delta exists. */
  state: 'no_data' | 'no_previous' | 'compared';
  currentWindow: { start: Date; end: Date } | null;
  previousWindow: { start: Date; end: Date } | null;
  /** Real differences only; metrics absent on either side are omitted. */
  deltas: { key: MetricKey; delta: number }[];
  currentPoint: MetricPoint | null;
  previousPoint: MetricPoint | null;
}

/** Default comparison window: the current period is the last 7 days. */
export const METRIC_WINDOW_MS = 7 * 24 * 3_600_000;

/**
 * Compares the current period (the `windowMs` before `now`) with the same
 * length of time immediately before it. Engagement counters are cumulative,
 * so a delta is the last measurement of the current period minus the last
 * measurement of the previous one.
 */
export function compareMetricHistory(
  points: MetricPoint[],
  now: Date,
  windowMs: number = METRIC_WINDOW_MS,
): MetricsComparison {
  const sorted = [...points].sort((a, b) => a.fetchedAt.getTime() - b.fetchedAt.getTime());
  const currentWindow = { start: new Date(now.getTime() - windowMs), end: now };
  const previousWindow = { start: new Date(now.getTime() - 2 * windowMs), end: currentWindow.start };
  // A point exactly on the boundary belongs to the current period only.
  const inWindow = (point: MetricPoint, start: Date, end: Date, includeEnd: boolean) => {
    const t = point.fetchedAt.getTime();
    return t >= start.getTime() && (includeEnd ? t <= end.getTime() : t < end.getTime());
  };
  if (!sorted.length) return { state: 'no_data', currentWindow: null, previousWindow: null, deltas: [], currentPoint: null, previousPoint: null };
  const current = sorted.filter(p => inWindow(p, currentWindow.start, currentWindow.end, true));
  const previous = sorted.filter(p => inWindow(p, previousWindow.start, previousWindow.end, false));
  // A delta needs a measurement on both sides; anything else is an explicit
  // absence, never a fabricated 0 % change.
  if (!current.length || !previous.length)
    return { state: 'no_previous', currentWindow, previousWindow, deltas: [], currentPoint: null, previousPoint: null };
  const currentPoint = current[current.length - 1];
  const previousPoint = previous[previous.length - 1];
  const deltas: { key: MetricKey; delta: number }[] = [];
  for (const key of METRIC_KEYS) {
    const a = currentPoint.values[key];
    const b = previousPoint.values[key];
    if (typeof a === 'number' && typeof b === 'number') deltas.push({ key, delta: a - b });
  }
  if (!deltas.length) return { state: 'no_previous', currentWindow, previousWindow, deltas: [], currentPoint: null, previousPoint: null };
  return { state: 'compared', currentWindow, previousWindow, deltas, currentPoint, previousPoint };
}
