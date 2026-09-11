'use client';
import { useEffect } from 'react';

/** Fires once per page load and never blocks rendering; failures are irrelevant. */
export function ClientBeacon() {
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/internal/client-ready', { method: 'POST', keepalive: true, signal: controller.signal })
      .catch(() => {});
    return () => controller.abort();
  }, []);
  return null;
}
