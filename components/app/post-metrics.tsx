import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { compareMetricHistory, METRIC_KEYS, type MetricKey, type MetricPoint } from "@/lib/metrics/compare";

export interface TargetMetricsView {
  targetId: string;
  channelName: string;
  /** Whether the adapter can report metrics at all (Telegram cannot). */
  reportsMetrics: boolean;
  published: boolean;
  /** Latest stored fetch for this target, of any outcome, or null if none yet. */
  latest: { outcome: string; fetchedAt: Date; values: Record<MetricKey, number | null> } | null;
  /** Only rows with outcome "ok", ascending — the measured time series. */
  points: MetricPoint[];
}

const METRIC_LABELS: Record<MetricKey, string> = {
  likes: "Likes",
  replies: "Replies",
  reposts: "Reposts",
  quotes: "Quotes",
  impressions: "Impressions",
};

/** A measured value, or an explicit absence — never a dash that reads as zero. */
function MetricValue({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="rounded-lg bg-gray-50 p-3">
      <dt className="text-sm text-gray-500">{label}</dt>
      {value === null ? (
        <dd className="text-sm text-gray-400">not reported</dd>
      ) : (
        <dd className="text-lg font-semibold tabular-nums">{value}</dd>
      )}
    </div>
  );
}

function TargetBlock({ view, now }: { view: TargetMetricsView; now: Date }) {
  const comparison = compareMetricHistory(view.points, now);
  let body: ReactNode;
  if (!view.published) {
    body = <p className="mt-1 text-gray-500">Not published yet.</p>;
  } else if (!view.latest) {
    body = (
      <p className="mt-1 text-gray-500">
        {view.reportsMetrics
          ? "No data from provider yet. The first refresh is still pending."
          : "This network does not report post statistics."}
      </p>
    );
  } else if (view.latest.outcome === "unsupported") {
    body = <p className="mt-1 text-gray-500">This network does not report post statistics.</p>;
  } else if (view.latest.outcome === "auth_expired") {
    body = (
      <p className="mt-1 text-amber-900">
        Channel access expired. Reconnect the channel to see statistics.
      </p>
    );
  } else if (view.latest.outcome === "provider_error") {
    body = <p className="mt-1 text-amber-900">The provider did not return data for this post.</p>;
  } else {
    const latest = view.latest;
    body = (
      <>
        <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
          {METRIC_KEYS.map((key) => (
            <MetricValue key={key} label={METRIC_LABELS[key]} value={latest.values[key]} />
          ))}
        </dl>
        <p className="mt-3 text-sm text-gray-600">
          {comparison.state === "compared"
            ? `Compared to the previous period: ${comparison.deltas
                .map((d) => `${d.delta >= 0 ? "+" : ""}${d.delta} ${METRIC_LABELS[d.key].toLowerCase()}`)
                .join(", ")}.`
            : "No previous data."}
        </p>
      </>
    );
  }
  return (
    <div className="rounded-xl border border-gray-200 p-4">
      <h3 className="font-semibold">{view.channelName}</h3>
      {body}
    </div>
  );
}

export function PostMetrics({ targets, now }: { targets: TargetMetricsView[]; now: Date }) {
  const anyPublished = targets.some((t) => t.published);
  return (
    <Card>
      <h2 className="text-xl font-semibold">Post performance</h2>
      {!targets.length ? (
        <p className="mt-2 text-gray-500">No channels were selected for this post.</p>
      ) : !anyPublished ? (
        <p className="mt-2 text-gray-500">
          Not published yet — statistics appear after the post is published.
        </p>
      ) : (
        <div className="mt-4 space-y-4">
          {targets.map((t) => (
            <TargetBlock key={t.targetId} view={t} now={now} />
          ))}
        </div>
      )}
    </Card>
  );
}
