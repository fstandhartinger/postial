'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Plan } from '@/lib/plans';
export function CheckoutButton({ plan, children = 'Start 14-day free trial' }: { plan: Plan; children?: React.ReactNode }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function checkout() {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const session = await fetch('/api/auth/session').then(response => response.json());
      if (!session?.user) { router.push(`/login?next=/pricing&plan=${plan}`); return; }
      const response = await fetch('/api/stripe/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan }) });
      if (response.status === 401) { router.push(`/login?next=/pricing&plan=${plan}`); return; }
      const data: { url?: string; error?: string } = await response.json();
      if (!response.ok || !data.url) throw new Error(data.error ?? 'We couldn’t start checkout. Try again. If it still fails, contact support.');
      window.location.assign(data.url);
    } catch (error) { setError(error instanceof Error ? error.message : 'We couldn’t start checkout. Try again. If it still fails, contact support.'); setBusy(false); }
  }
  return <><button type="button" disabled={busy} onClick={checkout}>{busy ? 'Opening checkout…' : children}</button>{error && <p role="alert">{error}</p>}</>;
}
