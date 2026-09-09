import Link from "next/link";
import { composerData } from "@/lib/core";
import { channelTextLimit } from "@/lib/text-limits";
import { BulkEditor } from "@/components/core/bulk-editor";
export default async function BulkPage({
  searchParams,
}: {
  searchParams: Promise<{ brand?: string }>;
}) {
  const data = await composerData(),
    q = await searchParams;
  return (
    <>
      <h1 className="text-3xl font-semibold">Plan several posts</h1>
      {data.brands.length ? (
        <BulkEditor
          brands={data.brands}
          channels={data.channels.map((c) => ({
            ...c,
            max: channelTextLimit(c),
          }))}
          initialBrand={data.brands.find((b) => b.id === q.brand)?.id}
          canPublish={data.canPublish}
          approvalLinks={data.approvalLinks}
        />
      ) : (
        <Link className="underline" href="/app/brands">
          Create your first brand
        </Link>
      )}
    </>
  );
}
