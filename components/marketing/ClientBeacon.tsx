'use client';
import { useEffect } from 'react';

/**
 * Fires once per page load and never blocks rendering; failures are irrelevant.
 * The path comes from the server-rendered page, not from window.location, so a visitor
 * cannot choose what we record.
 */
export function ClientBeacon({ path }: { path: string }) {
  useEffect(() => {
    const body = JSON.stringify({ path });
    // sendBeacon is fire-and-forget: page navigation and the public HTML response do
    // not wait on funnel persistence. Keep fetch as a small fallback for browsers
    // that do not expose sendBeacon.
    if (typeof navigator.sendBeacon === 'function' && navigator.sendBeacon(
      '/api/internal/client-ready', new Blob([body], { type: 'application/json' }),
    )) return;
    void fetch('/api/internal/client-ready', {
      method: 'POST',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body,
    }).catch(() => {});
  }, [path]);
  return null;
}
