import { calendarWindow } from "@/lib/calendar-window";
import Link from "next/link";
import { eq, and, sql } from "drizzle-orm";
import { brands, posts } from "@/db/schema";
import { coreContext } from "@/lib/core";
import { Calendar } from "@/components/core/calendar";
import { inZone } from "@/lib/timezone";
export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ brand?: string; date?: string; view?: string }>;
}) {
  const { db, workspace } = await coreContext();
  const q = await searchParams;
  const window = calendarWindow(q.date, q.view);
  const rows = await db
    .select({ post: posts, brand: brands })
    .from(posts)
    .innerJoin(brands, eq(brands.id, posts.brandId))
    .where(and(eq(brands.workspaceId, workspace.id),
      q.brand ? eq(brands.id, q.brand) : undefined,
      sql`(${posts.scheduledAt} AT TIME ZONE ${brands.timezone})::date >= ${window.start}::date`,
      sql`(${posts.scheduledAt} AT TIME ZONE ${brands.timezone})::date < ${window.end}::date`,
    ));
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-3xl font-semibold">Calendar</h1><Link className="text-emerald-700 underline" href={"/app/posts/bulk"+(q.brand?"?brand="+encodeURIComponent(q.brand!):"")}>Plan several posts</Link></div>
      <Calendar
        brand={q.brand}
        anchor={window.anchor}
        view={window.view}
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
