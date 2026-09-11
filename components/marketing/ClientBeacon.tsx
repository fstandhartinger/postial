'use client';
import { useEffect } from 'react';

/**
 * Fires once per page load and never blocks rendering; failures are irrelevant.
 * The path comes from the server-rendered page, not from window.location, so a visitor
 * cannot choose what we record.
 */
export function ClientBeacon({ path }: { path: string }) {
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/internal/client-ready', {
      method: 'POST',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
      signal: controller.signal,
    }).catch(() => {});
    return () => controller.abort();
  }, [path]);
  return null;
}
