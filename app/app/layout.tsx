import { FocusClearance } from "@/components/app/focus-clearance";
import { headers } from 'next/headers';
import { NotificationBell } from '@/components/app/notification-bell';
import { TrialBanner } from '@/components/billing/TrialBanner';
import { getSubscriptionForWorkspace } from '@/lib/billing';
import Link from "next/link";
import { switchWorkspace } from "./workspace-actions";
import { eq, and, countDistinct } from "drizzle-orm";
import { postTargets, posts, brands, users, workspaces, workspaceMembers } from "@/db/schema";
import { auth, signOut } from "@/auth";
import { coreContext } from "@/lib/core";
import { BrandSwitcher } from "@/components/core/brand-switcher";
import { Navigation, NewPostLink } from "@/components/app/navigation";
import { Button } from "@/components/ui/button";
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if(session?.user?.id) {
    const { getDb } = await import('@/db');
    const memberships = await getDb().select({id:workspaceMembers.workspaceId}).from(workspaceMembers).where(eq(workspaceMembers.userId,session.user.id)).limit(1);
    if(!memberships.length && (await headers()).get("x-socialmint-path")?.startsWith("/app/settings/account")) return <main className="mx-auto max-w-3xl space-y-6 p-6"><Link href="/app">Create a workspace</Link><Link className="ml-4" href="/app/settings/account">Account settings</Link>{children}</main>;
  }
  const { db, workspace, userId, role } = await coreContext();
  const [list, user] = await Promise.all([
    db
      .select({ id: brands.id, name: brands.name })
      .from(brands)
      .where(eq(brands.workspaceId, workspace.id)),
    db.select({ name: users.name }).from(users).where(eq(users.id, userId)),
  ]);
  const subscription = await getSubscriptionForWorkspace(workspace.id);
  const [held] = await db.select({total:countDistinct(posts.id)}).from(posts).innerJoin(brands,eq(brands.id,posts.brandId)).innerJoin(postTargets,eq(postTargets.postId,posts.id)).where(and(eq(brands.workspaceId,workspace.id),eq(postTargets.status,'held')));
  const settingsHref = role === 'owner' ? '/app/settings/team' : undefined;
  const memberships = await db.select({ id: workspaces.id, name: workspaces.name }).from(workspaceMembers).innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId)).where(eq(workspaceMembers.userId, userId));
  const switcher = <form action={switchWorkspace} className="space-y-2"><label className="text-xs">Workspace<select name="workspace" aria-label="Workspace" defaultValue={workspace.id} className="w-full rounded border p-2">{memberships.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label><Button variant="secondary">Switch workspace</Button></form>;
  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <Link href="/app" className="wordmark">
          Social<span>Mint</span>
        </Link>
        <Navigation
          settingsHref={settingsHref}
        />
        <div className="mt-auto space-y-3 border-t border-zinc-200 pt-4">
          <p className="truncate text-sm font-medium">
            {user[0]?.name || "Your account"}
          </p>
          <p className="truncate text-xs text-zinc-600">{workspace.name}</p>
          {switcher}
          <Link className="block" href="/app/settings/account">Account settings</Link>
          {role === "owner" && <Link className="block" href="/app/settings/workspace">Workspace settings</Link>}
          <form
            action={async () => {
              "use server";
              const session = await auth();
              if(session?.user?.id) { const { sessionActionBudget } = await import("@/lib/rate-limit"); await sessionActionBudget(session.user.id); }
              await signOut({ redirectTo: "/" });
            }}
          >
            <Button variant="secondary" className="w-full">
              Sign out
            </Button>
          </form>
        </div>
      </aside>
      <div className="min-w-0">
        <header className="app-topbar">
          <BrandSwitcher brands={list} />
          <NotificationBell workspaceId={workspace.id} userId={userId}/>
          <NewPostLink />
          <details className="relative md:hidden">
            <summary className="cursor-pointer p-2 text-sm">Account</summary>
            <div className="absolute right-0 z-30 w-48 space-y-3 rounded-2xl border bg-white p-4 shadow">
              {switcher}
              <Link href="/app/settings/account" className="block">Account settings</Link>
              {role === "owner" && <Link href="/app/settings/workspace" className="block">Workspace settings</Link>}
              <Link href="/app/billing" className="block">
                Billing
              </Link>
              {settingsHref && (
                <Link href={settingsHref} className="block">
                  Settings
                </Link>
              )}
              <form
                action={async () => {
                  "use server";
                  const session = await auth();
              if(session?.user?.id) { const { sessionActionBudget } = await import("@/lib/rate-limit"); await sessionActionBudget(session.user.id); }
              await signOut({ redirectTo: "/" });
                }}
              >
                <Button variant="secondary">Sign out</Button>
              </form>
            </div>
          </details>
        </header>
        <main id="main-content" className="app-content space-y-6">
          <TrialBanner subscription={subscription ? {status:subscription.status,trialEnd:subscription.trialEnd?.toISOString()??null,currentPeriodEnd:subscription.currentPeriodEnd?.toISOString()??null} : null} held={held.total}/>
          {children}
        </main>
      </div>
      <Navigation mobile /><FocusClearance />
      <NewPostLink mobile />
    </div>
  );
}
