"use client";
import Link from 'next/link';
import {useBrowserClock} from '@/components/core/browser-clock';
import {trialNotice} from '@/lib/trial-notice';
export function TrialBanner({subscription,held}:{subscription:{status:string;trialEnd:string|null;currentPeriodEnd?:string|null}|null;held:number}) {
  const now=useBrowserClock();
  const zone=now?Intl.DateTimeFormat().resolvedOptions().timeZone:'UTC';
  const status=now?trialNotice(subscription,now):null;
  if(!status || !subscription?.trialEnd) return held>0 ? <aside role="status" className="rounded-xl bg-amber-50 p-4">{held} posts paused. <Link className="underline" href="/app/billing">Update billing</Link></aside>:null;
  return <aside data-trial-banner role="status" className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950"><strong>{status==='expired'?'Your trial has ended':'Your trial ends soon'}</strong><p><time dateTime={subscription.trialEnd}>{new Date(subscription.trialEnd).toLocaleString('en-US',{timeZone:zone,dateStyle:'medium',timeStyle:'short'})}</time> ({zone}, browser timezone).</p><p>Scheduled posts pause until you add a payment method.</p>{status==='expired' && <p>{held} posts currently held. Due posts pause as the worker checks them.</p>}<Link className="inline-block rounded border px-3 py-2 font-semibold" href="/app/billing">Update billing</Link></aside>;
}
