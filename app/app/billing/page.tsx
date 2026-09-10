import { trialNotice } from '@/lib/trial-notice';
import { nextCharge } from '@/lib/billing-summary';
import { coreContext } from '@/lib/core';
import { trialTerms } from '@/components/billing/AccessStatus';
import Link from "next/link";
import { getSubscriptionForWorkspace, hasAccess } from "@/lib/billing";
import { plans } from "@/lib/plans";
import { CheckoutButton } from "@/components/billing/CheckoutButton";
import { PortalButton } from "@/components/billing/PortalButton";
import { Card } from "@/components/ui/card";
export default async function BillingPage() {
  const { workspace, role } = await coreContext();
  const record = await getSubscriptionForWorkspace(workspace.id);
  const subscription = record?.stripeSubscriptionId ? record : null;
  const owner = role === 'owner';
  const access = hasAccess(subscription);
  const date = subscription?.status === "trialing" ? subscription.trialEnd : subscription?.currentPeriodEnd;
  const charge = owner ? await nextCharge(subscription) : null;
  const expired = subscription?.status === 'trialing' && (!subscription.trialEnd || trialNotice({status:subscription.status,trialEnd:subscription.trialEnd.toISOString()}) === 'expired');
  const label = !subscription ? 'No plan yet' : expired ? 'Trial ended' : subscription.status === 'trialing' ? 'Free trial' : ({active:'Active subscription',past_due:'Payment overdue',canceled:'Canceled',unpaid:'Payment required',incomplete:'Payment setup incomplete'} as Record<string,string>)[subscription.status] ?? 'Subscription inactive';
  return <div className="space-y-6">
    <Link href="/app" className="text-emerald-700 underline">Back to workspace</Link>
    <h1 className="text-3xl font-semibold">Billing</h1><Link href="/docs/billing" target="_blank" rel="noopener noreferrer" aria-label="Billing help (opens in a new tab)" title="Billing help" className="inline-flex h-8 w-8 items-center justify-center rounded-full border text-sm">?</Link>
    <p>{trialTerms}</p>
    <Card className="space-y-4">
      <h2 className="text-xl font-semibold">{subscription ? plans[subscription.plan].name : "No plan yet"}</h2>
      {subscription && <p>€{plans[subscription.plan].monthlyEuro}/month · including VAT</p>}
      <p>{label}{subscription?.status==='trialing' && !expired && subscription.trialEnd ? ` · ends ${subscription.trialEnd.toLocaleDateString('en-US',{timeZone:'UTC',dateStyle:'medium'})} · then €${plans[subscription.plan].monthlyEuro}/month if you add a payment method` : ''}</p>
      {charge && <p>{charge}</p>}
      {date && <p>{subscription?.status === "trialing" ? "Trial ends" : subscription?.status === "canceled" ? "Period ended" : subscription?.cancelAtPeriodEnd ? "Access ends" : "Current period ends"}: <time dateTime={date.toISOString()}>{date.toLocaleDateString("en-GB", { timeZone: "UTC" })}</time></p>}
      {!access && <p>Choose a plan or update your billing to access publishing features. Your workspace remains available.</p>}
      {subscription?.cancelAtPeriodEnd && <p>Your subscription will cancel at the end of this period.</p>}
      <p>Cancel in the billing portal: access continues until the current paid period ends. Renewal reconciliation may take up to three days; scheduled posts pause after that. Drafts and history remain available. Cancel during a trial to prevent the first charge.</p>
      {owner && record?.stripeCustomerId && <div className="space-y-3"><PortalButton label="Manage payment method, plan and cancellation"/><PortalButton label="View invoice history"/></div>}
      {!owner && <p>Contact your workspace owner to manage billing.</p>}
    </Card>
    {owner && (!subscription || ["canceled", "incomplete_expired", "unpaid"].includes(subscription.status)) && <div className="grid gap-6 md:grid-cols-2">
      {(["starter", "agency"] as const).map(plan => <Card key={plan} className="space-y-4">
        <h2 className="text-xl font-semibold">{plans[plan].name}</h2>
        <p>€{plans[plan].monthlyEuro}/month · {plans[plan].brands} brands · {plans[plan].seats} {plans[plan].seats === 1 ? "seat" : "seats"}</p>
        <p>{workspace.trialUsedAt || subscription ? "Paid restart at the displayed monthly price. No additional free trial." : "14-day free trial. No card required."}</p>
        <CheckoutButton plan={plan}>{workspace.trialUsedAt || subscription ? "Restart plan" : "Start 14-day free trial"}</CheckoutButton>
      </Card>)}
    </div>}
  </div>;
}
