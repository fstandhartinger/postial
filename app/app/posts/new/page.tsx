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
      <h1 className="text-3xl font-semibold">Create a post</h1>
      {data.brands.length ? (
        <Composer
        canPublish={data.canPublish}
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
