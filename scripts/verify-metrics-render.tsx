import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PostMetrics, type TargetMetricsView } from '../components/app/post-metrics';

type PartialValues = Partial<TargetMetricsView['points'][number]['values']>;
function values(partial: PartialValues = {}) {
  return { likes: null, replies: null, reposts: null, quotes: null, impressions: null, ...partial };
}
function target(overrides: Partial<TargetMetricsView> = {}): TargetMetricsView {
  const points = overrides.points ?? [];
  const latest = overrides.latest ?? (points.length ? { outcome: 'ok', ...points[points.length - 1] } : null);
  return {
    targetId: 'render-target', channelName: 'Render fixture', reportsMetrics: true,
    provider: 'bluesky', published: true, latest, points, ...overrides,
  };
}

test('AN-3: comparison is labeled as cumulative snapshot change, never period-earned', () => {
  const now = new Date('2026-09-17T00:00:00Z');
  const points = [
    { fetchedAt: new Date('2026-09-08T12:00:00Z'), values: values({ likes: 10 }) },
    { fetchedAt: new Date('2026-09-16T12:00:00Z'), values: values({ likes: 15 }) },
  ];
  const html = renderToStaticMarkup(createElement(PostMetrics, { targets: [target({ points })], now }));
  assert.match(html, /\+5 likes/);
  assert.match(html, /cumulative/i);
  assert.match(html, /not engagement earned/i);
  assert.doesNotMatch(html, /%|previous period/i);
});

test('AN-3: both actual snapshot dates and times are exposed', () => {
  const now = new Date('2026-09-17T00:00:00Z');
  const points = [
    { fetchedAt: new Date('2026-09-08T12:00:00Z'), values: values({ likes: 10 }) },
    { fetchedAt: new Date('2026-09-16T12:00:00Z'), values: values({ likes: 15 }) },
  ];
  const html = renderToStaticMarkup(createElement(PostMetrics, { targets: [target({ points })], now }));
  assert.match(html, /2026-09-08 12:00 UTC/);
  assert.match(html, /2026-09-16 12:00 UTC/);
});

test('AN-3: empty previous period is explicit, never a fabricated delta', () => {
  const now = new Date('2026-09-17T00:00:00Z');
  const points = [{ fetchedAt: new Date('2026-09-16T12:00:00Z'), values: values({ likes: 15 }) }];
  const html = renderToStaticMarkup(createElement(PostMetrics, { targets: [target({ points })], now }));
  assert.match(html, /No previous data/);
  assert.doesNotMatch(html, /\+5|0\s*%/);
});

test('AN-1: a successful refresh exposes its measurement timestamp, even when old', () => {
  const now = new Date('2026-09-17T00:00:00Z');
  const points = [{ fetchedAt: new Date('2026-08-20T12:00:00Z'), values: values({ likes: 0 }) }];
  const html = renderToStaticMarkup(createElement(PostMetrics, { targets: [target({ points })], now }));
  assert.match(html, /Last successfully measured 2026-08-20 12:00 UTC/);
  assert.match(html, />0</);
  assert.match(html, /not reported/);
});

test('AN-1: a failed refresh retains the last success with its real time and figures', () => {
  const now = new Date('2026-09-17T00:00:00Z');
  const points = [{ fetchedAt: new Date('2026-09-14T12:00:00Z'), values: values({ likes: 22 }) }];
  const stale = target({ points, latest: { outcome: 'provider_error', fetchedAt: new Date('2026-09-16T12:00:00Z'), values: values() } });
  const html = renderToStaticMarkup(createElement(PostMetrics, { targets: [stale], now }));
  assert.match(html, /provider did not return data/i);
  assert.match(html, /last successful refresh on 2026-09-14 12:00 UTC/);
  assert.match(html, />22</);
});
