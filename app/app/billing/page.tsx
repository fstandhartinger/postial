import { requireLogin } from '@/lib/require-login';
import { trialTerms } from '@/components/billing/AccessStatus';
import Link from "next/link";
import { auth } from "@/auth";
import { ensureWorkspace } from "@/lib/workspaces";
import { getSubscriptionForWorkspace, hasAccess } from "@/lib/billing";
import { plans } from "@/lib/plans";
import { CheckoutButton } from "@/components/billing/CheckoutButton";
import { PortalButton } from "@/components/billing/PortalButton";
import { Card } from "@/components/ui/card";
export default async function BillingPage() {
  const session = await auth();
  if (!session?.user?.id) return requireLogin();
  const workspace = await ensureWorkspace(session.user.id);
  const record = await getSubscriptionForWorkspace(workspace.id);
  const subscription = record?.stripeSubscriptionId ? record : null;
  const owner = workspace.ownerUserId === session.user.id;
  const access = hasAccess(subscription);
  const date = subscription?.status === "trialing" ? subscription.trialEnd : subscription?.currentPeriodEnd;
  return <div className="space-y-6">
    <Link href="/app" className="text-emerald-700 underline">Back to workspace</Link>
    <h1 className="text-3xl font-semibold">Billing</h1>
    <p>{trialTerms}</p>
    <Card className="space-y-4">
      <h2 className="text-xl font-semibold">{subscription ? plans[subscription.plan].name : "No plan yet"}</h2>
      <p>Status: {subscription?.status ?? "none"}</p>
      {date && <p>{subscription?.status === "trialing" ? "Trial ends" : subscription?.status === "canceled" ? "Period ended" : subscription?.cancelAtPeriodEnd ? "Access ends" : "Next billing date"}: <time dateTime={date.toISOString()}>{date.toLocaleDateString("en-GB", { timeZone: "UTC" })}</time></p>}
      {!access && <p>Choose a plan or update your billing to access publishing features. Your workspace remains available.</p>}
      {subscription?.cancelAtPeriodEnd && <p>Your subscription will cancel at the end of this period.</p>}
      {owner && record?.stripeCustomerId && <PortalButton />}
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
