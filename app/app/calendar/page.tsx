import Link from "next/link";
import { eq } from "drizzle-orm";
import { brands, posts } from "@/db/schema";
import { coreContext } from "@/lib/core";
import { Calendar } from "@/components/core/calendar";
import { inZone } from "@/lib/timezone";
export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ brand?: string }>;
}) {
  const { db, workspace } = await coreContext();
  const rows = await db
    .select({ post: posts, brand: brands })
    .from(posts)
    .innerJoin(brands, eq(brands.id, posts.brandId))
    .where(eq(brands.workspaceId, workspace.id));
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-3xl font-semibold">Calendar</h1><Link className="text-emerald-700 underline" href={"/app/posts/bulk"+((await searchParams).brand?"?brand="+encodeURIComponent((await searchParams).brand!):"")}>Plan several posts</Link></div>
      <Calendar
        brand={(await searchParams).brand}
        entries={rows
          .filter((r) => r.post.scheduledAt)
          .map(({ post: p, brand: b }) => ({
            id: p.id,
            body: p.body,
            day: inZone(p.scheduledAt!, b.timezone).slice(0, 10),
            brandId: b.id,
            brand: b.name,
            color: b.color,
            status: p.status,
          }))}
      />
    </>
  );
}
