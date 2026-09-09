"use client";
import { useEffect, useRef } from 'react';
import Link from 'next/link';
import type { Plan } from '@/lib/plans';
import { CheckoutButton } from './CheckoutButton';
export function ContinueCheckout({ plan, next }: { plan: Plan; next: string }) {
  const container = useRef<HTMLDivElement>(null);
  const started = useRef(false);
  useEffect(() => {
    if (!started.current) { started.current = true; container.current?.querySelector('button')?.click(); }
  }, []);
  return <div ref={container} className="space-y-6"><h1>Continue to checkout</h1><CheckoutButton plan={plan}>Continue to checkout</CheckoutButton><p><Link href={next}>Return to Postial</Link></p></div>;
}
