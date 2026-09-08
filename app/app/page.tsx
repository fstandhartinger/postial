import { AccessStatus } from '@/components/billing/AccessStatus';
import Link from "next/link";
import { getSubscriptionForWorkspace, hasAccess } from "@/lib/billing";
import { plans } from "@/lib/plans";
import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";
import { ensureWorkspace } from "@/lib/workspaces";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
export default async function Workspace({ searchParams }: { searchParams: Promise<{ checkout?: string }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login?next=/app");
  const workspace = await ensureWorkspace(session.user.id);
  const record = await getSubscriptionForWorkspace(workspace.id);
  const subscription = record?.stripeSubscriptionId ? record : null;
  const access = hasAccess(subscription?.status ?? "none", subscription?.pastDueSince);
  const { checkout } = await searchParams;
  return <>{checkout === "success" && <p role="status" className="mb-6 rounded-xl bg-emerald-50 p-4">{subscription?.status === "trialing" ? "Your trial has started." : subscription?.status === "active" ? "Your subscription is active." : "Checkout returned — confirming your subscription…"}</p>}
<AccessStatus /><div className="flex flex-wrap items-center justify-between gap-4"><div><p className="mb-2 text-sm text-gray-500">Your workspace</p><h1 className="text-3xl font-semibold">{workspace.name}</h1></div><Link href="/app/billing"><Badge>{subscription ? `${plans[subscription.plan].name} · ${subscription.status}` : "No plan yet · start your 14-day trial"}</Badge></Link></div>{!access && <p className="mt-6">Publishing access requires a plan. <Link href="/app/billing" className="text-emerald-700 underline">Review billing and start your trial</Link>.</p>}<Card className="mt-10 py-16 text-center"><div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-2xl text-emerald-600" aria-hidden="true">＋</div><h2 className="text-xl font-semibold">Connect your first channel</h2><p className="mt-3 text-gray-500">Your publishing workspace is ready. Channel connections are coming soon.</p></Card><form className="mt-8" action={async () => { "use server"; await signOut({ redirectTo: "/" }); }}><Button>Sign out</Button></form></>;
}
