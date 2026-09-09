import { Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { eq, desc } from "drizzle-orm";
import { brands, posts, postStatus } from "@/db/schema";
import { coreContext } from "@/lib/core";
import { Card } from "@/components/ui/card";
import { ApprovalStatusBadge } from "@/components/approvals/status-badge";
export default async function PostsPage({
  searchParams,
}: {
  searchParams: Promise<{ brand?: string; status?: string }>;
}) {
  const { db, workspace } = await coreContext(),
    q = await searchParams;
  const rows = await db
    .select({ post: posts, brand: brands })
    .from(posts)
    .innerJoin(brands, eq(brands.id, posts.brandId))
    .where(eq(brands.workspaceId, workspace.id))
    .orderBy(desc(posts.createdAt));
  const bs = await db
    .select()
    .from(brands)
    .where(eq(brands.workspaceId, workspace.id));
  const filtered = rows.filter(
    (r) =>
      (!q.brand || r.brand.id === q.brand) &&
      (!q.status || r.post.status === q.status),
  );
  return (
    <>
      <div className="flex justify-between">
        <h1 className="text-3xl font-semibold">Posts</h1>
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
              {s === "pending_approval"
                ? "Awaiting approval"
                : s === "changes_requested"
                  ? "Changes requested"
                  : s}
            </option>
          ))}
        </Select>
        <Button variant="secondary" className="rounded border px-4">
          Filter
        </Button>
      </form>
      {filtered.map(({ post: p, brand: b }) => (
        <Card key={p.id}>
          <Link className="block font-semibold" href={`/app/posts/${p.id}`}>
            {p.body.slice(0, 140)}
          </Link>
          <p>
            <span style={{ color: b.color }}>{b.name}</span>
            {!["pending_approval", "changes_requested"].includes(p.status) && (
              <> · {p.status.replaceAll("_", " ")}</>
            )}
          </p>
          <ApprovalStatusBadge post={p} />
          {p.scheduledAt && (
            <p className="text-sm text-gray-500">
              {p.scheduledAt.toLocaleString("en-GB", { timeZone: b.timezone })}{" "}
              ({b.timezone})
            </p>
          )}
        </Card>
      ))}
      {!filtered.length && (
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
