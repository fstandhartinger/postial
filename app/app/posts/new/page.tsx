import Link from "next/link";
import { composerData } from "@/lib/core";
import { channelTextLimit } from "@/lib/text-limits";
import { Composer } from "@/components/core/composer";
export default async function NewPost({
  searchParams,
}: {
  searchParams: Promise<{ brand?: string; date?: string }>;
}) {
  const data = await composerData(),
    q = await searchParams;
  return (
    <>
      <h1 className="text-3xl font-semibold">Create a post</h1><Link href="/docs/first-post" target="_blank" rel="noopener noreferrer" aria-label="Composer help (opens in a new tab)" title="Composer help" className="inline-flex h-8 w-8 items-center justify-center rounded-full border text-sm">?</Link>
      {data.brands.length ? (
        <Composer
        canPublish={data.canPublish} approvalLinks={data.approvalLinks}
          key={q.brand ?? "all"}
          brands={data.brands}
          channels={data.channels.map((c) => ({
            ...c,
            max: channelTextLimit(c),
          }))}
          initial={{
            brandId: data.brands.some((b) => b.id === q.brand)
              ? q.brand
              : undefined,
            scheduledAt:
              q.date && /^\d{4}-\d{2}-\d{2}$/.test(q.date)
                ? q.date + "T09:00"
                : undefined,
          }}
        />
      ) : (
        <Link className="underline" href="/app/brands">
          Create your first brand
        </Link>
      )}
    </>
  );
}
