import { ConnectError } from '@/components/core/connect-error';
import { Badge } from "@/components/ui/badge";
import { ProviderBadge } from "@/components/app/provider-badge";
import { canEditBrand } from "@/lib/entitlements";
import { eq } from "drizzle-orm";
import { channels } from "@/db/schema";
import { ownBrand } from "@/lib/core";
import { availableProviders, getPublisher } from "@/lib/publishers";
import { ActionForm, ConnectForm } from "@/components/core/forms";
import { Card } from "@/components/ui/card";
export default async function BrandPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{connect_error?:string | string[]}>;
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
      <ConnectError code={(await searchParams).connect_error}/>
      {list.map((c) => (
        <Card key={c.id}>
          <div className="mb-3 flex items-center gap-3">
            <ProviderBadge provider={c.provider} />
            <h2 className="text-xl">{c.displayName}</h2>
          </div>
          <p>
            {c.provider} · <Badge>{c.status.replaceAll("_", " ")}</Badge>
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
      <Card id="connect">
        <h2 className="mb-4 text-xl font-semibold">Connect a channel</h2>
        <p className="mb-4 text-sm text-gray-500">
          Reconnect the same account to replace expired credentials.
        </p>
        <div className="mb-6 space-y-3">
          <details className="rounded-lg border border-zinc-200 p-3">
            <summary className="cursor-pointer font-medium">
              Bluesky setup help
            </summary>
            <p className="mt-3 text-sm">
              In Bluesky, open Settings → App Passwords and create a SocialMint
              app password. Enter your handle and the app password below, never
              your main password. Posts support 300 characters and up to four
              images, each up to 1 MB. Reconnect with a fresh app password if
              access expires.
            </p>
          </details>
          <details className="rounded-lg border border-zinc-200 p-3">
            <summary className="cursor-pointer font-medium">
              Mastodon setup help
            </summary>
            <p className="mt-3 text-sm">
              On your instance, open Preferences → Development → New
              application. Name it SocialMint and enable write:statuses,
              write:media and read:accounts. Copy Your access token, then enter
              your HTTPS instance URL and token below. Your instance sets the
              text limit, usually 500 characters.
            </p>
          </details>
          <details className="rounded-lg border border-zinc-200 p-3">
            <summary className="cursor-pointer font-medium">
              Telegram setup help
            </summary>
            <p className="mt-3 text-sm">
              Contact the official @BotFather yourself and use /newbot. Add your
              bot as a channel administrator with permission to post. Enter its
              token and the channel’s @username or numeric chat ID, including
              any minus sign. With images, the first 1024 characters become the
              caption and remaining text follows separately.
            </p>
          </details>
        </div>
        {(["x", "threads"] as const).map(provider => (
          <div key={provider} className="mb-4">
            {writable && availableProviders().includes(provider) ? (
              <form action={`/api/oauth/${provider}/start`} method="post">
                <input type="hidden" name="brandId" value={brand.id} />
                <button className="rounded border px-4 py-2" type="submit">Connect {provider === 'x' ? 'X' : 'Threads'}</button>
              </form>
            ) : !availableProviders().includes(provider) ? (
              <p>{provider === 'x' ? 'X' : 'Threads'} — coming soon. The operator must configure the developer app before connections are available.</p>
            ) : null}
          </div>
        ))}
        {writable && availableProviders().length ? (
          <ConnectForm
            brandId={brand.id}
            options={availableProviders().filter(p => p !== "x" && p !== "threads").map((provider) => ({
              provider,
              fields: getPublisher(provider).credentialFields,
            }))}
          />
        ) : (
          <p>
            This brand is read-only under your plan. Review Billing to upgrade.
          </p>
        )}
      </Card>
    </>
  );
}
