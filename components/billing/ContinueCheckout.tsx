"use client";
import Link from 'next/link';
import type { Plan } from '@/lib/plans';
import { CheckoutButton } from './CheckoutButton';
import { plans } from '@/lib/plans';
import { buttonClass } from '@/components/ui/button';
export function ContinueCheckout({ plan, next }: { plan: Plan; next: string }) {
  const selectedPlan = plans[plan];
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="space-y-3">
        <p className="text-sm font-medium text-emerald-700">{selectedPlan.name} plan</p>
        <h1>Review your plan before checkout</h1>
        <p className="text-lg text-zinc-700">
          You get 14 days free, then {selectedPlan.monthlyEuro} € / month including VAT.
        </p>
      </div>
      <section className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm sm:p-6" aria-labelledby="checkout-details">
        <h2 id="checkout-details" className="text-xl font-semibold">What to expect</h2>
        <ul className="list-disc space-y-2 pl-5 text-zinc-700">
          <li>14 days free.</li>
          <li>No card is needed for the trial.</li>
          <li>Cancel anytime.</li>
        </ul>
        <p className="text-sm text-zinc-600">
          The payment page is operated by our payment provider under the account name &quot;Amazing AI Apps&quot;.
        </p>
      </section>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <CheckoutButton plan={plan} className={buttonClass}>Continue to checkout</CheckoutButton>
        <Link href="/app" className={`${buttonClass} !border !border-zinc-500 !bg-white !text-zinc-950 hover:!bg-zinc-100`}>
          First set up your brand and look around
        </Link>
      </div>
      <p className="text-sm text-zinc-600">
        You can start the 14-day trial later anytime from <Link href="/app/billing" className="underline">Billing</Link>.
      </p>
      <p><Link href={next} className="text-emerald-700 underline">Return to Postial</Link></p>
    </div>
  );
}
