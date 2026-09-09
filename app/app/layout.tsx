import Link from "next/link";
import { existsSync } from "node:fs";
import { eq } from "drizzle-orm";
import { brands, users } from "@/db/schema";
import { signOut } from "@/auth";
import { coreContext } from "@/lib/core";
import { BrandSwitcher } from "@/components/core/brand-switcher";
import { Navigation, NewPostLink } from "@/components/app/navigation";
import { Button } from "@/components/ui/button";
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { db, workspace, userId } = await coreContext();
  const [list, user] = await Promise.all([
    db
      .select({ id: brands.id, name: brands.name })
      .from(brands)
      .where(eq(brands.workspaceId, workspace.id)),
    db.select({ name: users.name }).from(users).where(eq(users.id, userId)),
  ]);
  const settingsHref = existsSync(".next/server/app/app/settings/page.js")
    ? "/app/settings"
    : existsSync(".next/server/app/app/settings/api/page.js")
      ? "/app/settings/api"
      : undefined;
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
          <form
            action={async () => {
              "use server";
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
          <NewPostLink />
          <details className="relative md:hidden">
            <summary className="cursor-pointer p-2 text-sm">Account</summary>
            <div className="absolute right-0 z-30 w-48 space-y-3 rounded-2xl border bg-white p-4 shadow">
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
                  await signOut({ redirectTo: "/" });
                }}
              >
                <Button variant="secondary">Sign out</Button>
              </form>
            </div>
          </details>
        </header>
        <main id="main-content" className="app-content space-y-6">
          {children}
        </main>
      </div>
      <Navigation mobile />
      <NewPostLink mobile />
    </div>
  );
}
