import Link from "next/link";
import { eq } from "drizzle-orm";
import { brands } from "@/db/schema";
import { coreContext } from "@/lib/core";
import { BrandSwitcher } from "@/components/core/brand-switcher";
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { db, workspace } = await coreContext();
  const list = await db
    .select({ id: brands.id, name: brands.name })
    .from(brands)
    .where(eq(brands.workspaceId, workspace.id));
  return (
    <div className="grid gap-8 md:grid-cols-[160px_minmax(0,1fr)]">
      <nav aria-label="Workspace" className="flex flex-wrap gap-4 md:flex-col">
        {[
          ["Overview", "/app"],
          ["Calendar", "/app/calendar"],
          ["Posts", "/app/posts"],
          ["Brands", "/app/brands"],
          ["Billing", "/app/billing"],
        ].map(([label, url]) => (
          <Link
            className="rounded px-2 py-2 font-medium text-emerald-800 hover:bg-emerald-50"
            key={url}
            href={url}
          >
            {label}
          </Link>
        ))}
      </nav>
      <div className="min-w-0 space-y-6">
        <BrandSwitcher brands={list} />
        {children}
      </div>
    </div>
  );
}
