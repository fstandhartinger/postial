"use client";
import Link from 'next/link';
import type { Plan } from '@/lib/plans';
import { CheckoutButton } from './CheckoutButton';
import { plans } from '@/lib/plans';
import { buttonClass } from '@/components/ui/button';
import type { TrialEligibility } from '@/lib/trial-eligibility';
export function ContinueCheckout({ plan, next, trialStatus }: { plan: Plan; next: string; trialStatus: TrialEligibility }) {
  const selectedPlan = plans[plan];
  const trialAvailable = trialStatus === 'eligible';
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="space-y-3">
        <p className="text-sm font-medium text-emerald-700">{selectedPlan.name} plan</p>
        <h1>Review your plan before checkout</h1>
        <p className="text-lg text-zinc-700">
          {trialAvailable ? `You get 14 days free, then ${selectedPlan.monthlyEuro} € / month including VAT.` : `The ${selectedPlan.monthlyEuro} € / month price including VAT applies now, and a payment method is required.`}
        </p>
      </div>
      <section className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm sm:p-6" aria-labelledby="checkout-details">
        <h2 id="checkout-details" className="text-xl font-semibold">What to expect</h2>
        <ul className="list-disc space-y-2 pl-5 text-zinc-700">
          {trialAvailable ? <>
            <li>14 days free.</li>
            <li>No card is needed for the trial.</li>
          </> : <li>{trialStatus === 'ineligible' ? 'This workspace has already used its trial period. The monthly price applies now and a payment method is required.' : 'We could not confirm a free trial right now. The monthly price applies now and a payment method is required.'}</li>}
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
      {trialAvailable && <p className="text-sm text-zinc-600">
        You can start the 14-day trial later anytime from <Link href="/app/billing" className="underline">Billing</Link>.
      </p>}
      <p><Link href={next} className="text-emerald-700 underline">Return to Postial</Link></p>
    </div>
  );
}
