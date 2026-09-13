'use client';

import { useEffect, useState } from 'react';

export function RuntimeProviderStatus({ fallback }: { fallback: string }) {
  const [status, setStatus] = useState(fallback);
  useEffect(() => {
    void fetch('/api/internal/provider-status', { cache: 'no-store' })
      .then(response => response.ok ? response.json() as Promise<{ google?: boolean; email?: boolean }> : null)
      .then(providers => {
        if (!providers) return;
        const signIn = providers.google && providers.email ? 'Google sign-in and magic links are available' : providers.google ? 'Google sign-in is available' : providers.email ? 'Magic links are available' : 'Sign-in is not configured — try the interactive demo meanwhile';
        setStatus(signIn);
      })
      .catch(() => {});
  }, []);
  return <>{status}</>;
}
