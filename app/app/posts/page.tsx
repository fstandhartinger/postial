import {statusLabel} from "@/lib/status-label";
import { ActionForm } from "@/components/core/forms";
import { Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { eq, desc, and, count } from "drizzle-orm";
import { brands, posts, postStatus } from "@/db/schema";
import { coreContext } from "@/lib/core";
import { Card } from "@/components/ui/card";
import { ApprovalStatusBadge } from "@/components/approvals/status-badge";
export default async function PostsPage({
  searchParams,
}: {
  searchParams: Promise<{ brand?: string; status?: string; page?: string }>;
}) {
  const { db, workspace } = await coreContext(),
    q = await searchParams;
  const where = and(eq(brands.workspaceId, workspace.id),
    q.brand ? eq(brands.id, q.brand) : undefined,
    postStatus.enumValues.includes(q.status as typeof postStatus.enumValues[number])
      ? eq(posts.status, q.status as typeof postStatus.enumValues[number]) : undefined);
  const [total] = await db.select({ value: count() }).from(posts)
    .innerJoin(brands, eq(brands.id, posts.brandId)).where(where);
  const pages = Math.max(1, Math.ceil(total.value / 50));
  const page = Math.min(pages, Math.max(1, Number.isSafeInteger(Number(q.page)) ? Number(q.page) : 1));
  const rows = await db.select({ post: posts, brand: brands }).from(posts)
    .innerJoin(brands, eq(brands.id, posts.brandId)).where(where)
    .orderBy(desc(posts.createdAt), desc(posts.id)).limit(50).offset((page - 1) * 50);
  const pageUrl = (n: number) => '/app/posts?' + new URLSearchParams({
    ...(q.brand ? {brand: q.brand} : {}), ...(q.status ? {status: q.status} : {}), page: String(n),
  });
  const bs = await db
    .select()
    .from(brands)
    .where(eq(brands.workspaceId, workspace.id));
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-semibold">Posts</h1>
        <Link className="text-emerald-700 underline" href={"/app/posts/bulk"+(q.brand?"?brand="+encodeURIComponent(q.brand):"")}>Plan several posts</Link>
        <Link className="text-emerald-700 underline" href="/app/posts/new">
          Create post
        </Link>
      </div>
      <form className="flex flex-wrap gap-3">
        <Select
          aria-label="Filter brand"
          className="rounded border p-2"
          name="brand"
          defaultValue={q.brand}
        >
          <option value="">All brands</option>
          {bs.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Filter status"
          className="rounded border p-2"
          name="status"
          defaultValue={q.status}
        >
          <option value="">All statuses</option>
          {postStatus.enumValues.map((s) => (
            <option key={s} value={s}>
              {statusLabel(s)}
            </option>
          ))}
        </Select>
        <Button variant="secondary" className="rounded border px-4">
          Filter
        </Button>
      </form>
      <nav aria-label="Post pages" className="flex flex-wrap items-center gap-4">
        <p>{total.value} posts · Page {page} of {pages}</p>
        {page > 1 && <Link className="underline" href={pageUrl(page - 1)}>Previous page</Link>}
        {page < pages && <Link className="underline" href={pageUrl(page + 1)}>Next page</Link>}
      </nav>
      {rows.map(({ post: p, brand: b }) => (
        <Card key={p.id}>
          <Link className="block font-semibold" href={`/app/posts/${p.id}`}>
            {p.body.slice(0, 140)}
          </Link>
          <p>
            <span style={{ color: b.color }}>{b.name}</span>
            {!["pending_approval", "changes_requested"].includes(p.status) && (
              <> · {statusLabel(p.status)}</>
            )}
          </p>
          <ApprovalStatusBadge post={p} />
          <ActionForm action="duplicate"><input type="hidden" name="postId" value={p.id}/></ActionForm>
          {p.scheduledAt && (
            <p className="text-sm text-gray-500">
              {p.scheduledAt.toLocaleString("en-GB", { timeZone: b.timezone })}{" "}
              ({b.timezone})
            </p>
          )}
        </Card>
      ))}
      {!rows.length && (
        <Card>
          <Link href="/app/posts/new">Schedule your first post</Link>
          <p className="mt-2 text-gray-500">
            Your drafts and scheduled posts will appear here.
          </p>
        </Card>
      )}
    </>
  );
}
