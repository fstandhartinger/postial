import { ConnectError } from '@/components/core/connect-error';
import { workspaceEntitlements } from '@/lib/entitlements';
import Link from "next/link";
import { eq } from "drizzle-orm";
import { brands } from "@/db/schema";
import { coreContext } from "@/lib/core";
import { BrandForm } from "@/components/core/forms";
import { Card } from "@/components/ui/card";

export default async function BrandsPage({searchParams}: {searchParams: Promise<{connect_error?:string | string[]}>}) {
  const { db, workspace } = await coreContext();
  const list = await db
    .select()
    .from(brands)
    .where(eq(brands.workspaceId, workspace.id));
  const entitlement = await workspaceEntitlements(workspace);
  const active = entitlement.publish;
  return (
    <>
      <h1 className="text-3xl font-semibold">Brands</h1>
      <ConnectError code={(await searchParams).connect_error}/>
      <p>
        {list.length} / {entitlement.limit} brands
        {!active &&
          " · Starter limit applies without an active subscription or trial."}{" "}
        <Link href="/app/billing" className="underline">
          Billing
        </Link>
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        {list.map((b) => (
          <Card key={b.id}>
            <Link
              className="text-lg font-semibold"
              href={`/app/brands/${b.id}`}
            >
              <span
                className="mr-2 inline-block h-3 w-3 rounded-full"
                style={{ background: b.color }}
              />
              {b.name}
            </Link>
            <p className="text-gray-500">{b.timezone}</p>
            {!entitlement.activeBrandIds.includes(b.id) && <p className="text-amber-800">Read-only: above your plan’s brand limit. The oldest brands remain active. <Link href="/app/billing" className="underline">Review Billing</Link></p>}
          </Card>
        ))}
      </div>
      <Card>
        <h2 className="mb-4 text-xl font-semibold">
          {list.length ? "Create a brand" : "Create your first brand"}
        </h2>
        <BrandForm />
      </Card>
    </>
  );
}
