import { canEditBrand } from '@/lib/entitlements';
import { eq } from "drizzle-orm";
import { channels } from "@/db/schema";
import { ownBrand } from "@/lib/core";
import { availableProviders, getPublisher } from "@/lib/publishers";
import { ActionForm, ConnectForm } from "@/components/core/forms";
import { Card } from "@/components/ui/card";
export default async function BrandPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { db, brand, workspace } = await ownBrand((await params).id);
  const writable = await canEditBrand(workspace, brand.id);
  const list = await db
    .select({
      id: channels.id,
      displayName: channels.displayName,
      provider: channels.provider,
      status: channels.status,
    })
    .from(channels)
    .where(eq(channels.brandId, brand.id));
  return (
    <>
      <h1 className="text-3xl font-semibold">{brand.name}</h1>
      <p>{brand.timezone}</p>
      {list.map((c) => (
        <Card key={c.id}>
          <h2 className="text-xl">{c.displayName}</h2>
          <p>
            {c.provider} · {c.status.replaceAll("_", " ")}
          </p>
          {writable && c.status !== "disconnected" && (
            <ActionForm action="disconnect">
              <input type="hidden" name="brandId" value={brand.id} />
              <input type="hidden" name="channelId" value={c.id} />
              <p>Disconnect channel (credentials will be removed)</p>
            </ActionForm>
          )}
        </Card>
      ))}
      <Card>
        <h2 className="mb-4 text-xl font-semibold">Connect a channel</h2>
        <p className="mb-4 text-sm text-gray-500">
          Reconnect the same account to replace expired credentials.
        </p>
        {writable && availableProviders().length ? (
          <ConnectForm
            brandId={brand.id}
            options={availableProviders().map((provider) => ({
              provider,
              fields: getPublisher(provider).credentialFields,
            }))}
          />
        ) : (
          <p>This brand is read-only under your plan. Review Billing to upgrade.</p>
        )}
      </Card>
    </>
  );
}
