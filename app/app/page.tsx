import {statusLabel} from "@/lib/status-label";
import Link from "next/link";
import { eq, and, asc, sql, inArray, gt } from "drizzle-orm";
import { brands, channels, posts, postTargets } from "@/db/schema";
import { coreContext } from "@/lib/core";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { workspaceEntitlements } from "@/lib/entitlements";
import { CopyLink } from "@/components/approvals/copy-link";
import { ProviderBadge } from "@/components/app/provider-badge";

export default async function Overview({
  searchParams,
}: {
  searchParams: Promise<{ brand?: string; checkout?: string }>;
}) {
  const { db, workspace } = await coreContext(),
    query = await searchParams;
  const scope = and(eq(brands.workspaceId, workspace.id), query.brand ? eq(brands.id, query.brand) : undefined);
  const week = (column: typeof posts.scheduledAt | typeof postTargets.publishedAt | typeof postTargets.updatedAt) =>
    sql`(${column} AT TIME ZONE ${brands.timezone}) >= date_trunc('week', now() AT TIME ZONE ${brands.timezone}) AND (${column} AT TIME ZONE ${brands.timezone}) < date_trunc('week', now() AT TIME ZONE ${brands.timezone}) + interval '7 days'`;
  const [bs, next, awaiting, cs, [counts], workspacePosts] = await Promise.all([
    db.select().from(brands).where(eq(brands.workspaceId, workspace.id)).orderBy(asc(brands.createdAt)),
    db.select({post: posts, brand: brands}).from(posts).innerJoin(brands, eq(posts.brandId, brands.id))
      .where(and(scope, inArray(posts.status, ['scheduled', 'approved']), gt(posts.scheduledAt, new Date())))
      .orderBy(asc(posts.scheduledAt), asc(posts.id)).limit(5),
    db.select({post: posts, brand: brands}).from(posts).innerJoin(brands, eq(posts.brandId, brands.id))
      .where(and(scope, eq(posts.status, 'pending_approval'))).orderBy(asc(posts.createdAt), asc(posts.id)).limit(10),
    db.select({id: channels.id, brandId: channels.brandId, provider: channels.provider, name: channels.displayName, status: channels.status, brand: brands.name})
      .from(channels).innerJoin(brands, eq(channels.brandId, brands.id)).where(scope),
    db.select({
      scheduled: sql<number>`count(*) filter (where ${posts.status} in ('scheduled', 'approved') and ${week(posts.scheduledAt)})`.mapWith(Number),
      published: sql<number>`count(*) filter (where exists (select 1 from ${postTargets} where ${postTargets.postId} = ${posts.id} and ${postTargets.status} = 'published' and ${week(postTargets.publishedAt)}))`.mapWith(Number),
      failed: sql<number>`count(*) filter (where exists (select 1 from ${postTargets} where ${postTargets.postId} = ${posts.id} and ${postTargets.status} = 'failed' and ${week(postTargets.updatedAt)}))`.mapWith(Number),
    }).from(posts).innerJoin(brands, eq(posts.brandId, brands.id)).where(scope),
    db.select({ id: posts.id }).from(posts).innerJoin(brands, eq(posts.brandId, brands.id))
      .where(scope).limit(1),
  ]);
  const targetQuery = () => db.select({target: postTargets, postId: posts.id, brandId: brands.id, brand: brands.name, channel: channels.displayName, provider: channels.provider})
    .from(postTargets).innerJoin(posts, eq(postTargets.postId, posts.id)).innerJoin(brands, eq(posts.brandId, brands.id)).innerJoin(channels, eq(postTargets.channelId, channels.id));
  const [targets, attention] = await Promise.all([
    next.length ? targetQuery().where(and(scope, inArray(posts.id, next.map(r => r.post.id)))) : Promise.resolve([]),
    targetQuery().where(and(scope, inArray(postTargets.status, ['failed', 'needs_review', 'held'])))
      .orderBy(asc(postTargets.updatedAt), asc(postTargets.id)).limit(10),
  ]);
  const access = await workspaceEntitlements(workspace);
  const brandUrl = bs[0] ? `/app/brands/${bs[0].id}#connect` : "/app/brands";
  const steps = [
    {
      title: "Create a brand",
      benefit: "A brand keeps its content and channels together.",
      done: bs.length > 0,
      href: "/app/brands",
      action: "Create brand",
    },
    {
      title: "Plan your first post",
      benefit: "Create a post and choose when it should go out.",
      done: workspacePosts.length > 0,
      href: "/app/posts/new",
      action: "Plan post",
    },
    {
      // Deliberately last: connecting means leaving Postial to create credentials on the
      // network's own site, which is the hardest step and the one that can fail for reasons
      // outside our product. Drafting and client approval work without it, so a new user
      // reaches what makes us different before meeting that hurdle.
      title: "Connect a channel",
      benefit:
        "Publishing needs a channel. You set this up on the network's own site, so allow a few minutes.",
      done: cs.length > 0,
      href: brandUrl,
      action: "Connect channel",
    },
  ];
  const completed = steps.filter((s) => s.done).length;
  const expired = cs.filter(
    (c) =>
      (!query.brand || c.brandId === query.brand) &&
      c.status === "token_expired",
  );
  const origin = process.env.NEXT_PUBLIC_APP_URL || process.env.AUTH_URL;
  return (
    <>
      <div>
        <p className="text-sm text-zinc-600">{workspace.name}</p>
        <h1>Overview</h1>
        <p className="mt-2 text-zinc-600">
          A clear view of what’s going out and what needs you.
        </p>
      </div>
      {query.checkout === "success" && (
        <p role="status">
          Checkout returned. Your plan updates when payment confirmation
          arrives.
        </p>
      )}
      {!access.publish && (
        <Card>
          <p>
            Save drafts and set up your brands now. Start a plan to schedule and
            publish.
          </p>
          <Link href="/app/billing" className="text-emerald-700 underline">
            Explore plans and start your trial
          </Link>
        </Card>
      )}
      {completed < steps.length && (
        <Card aria-labelledby="onboarding-title">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="onboarding-title">Get started</h2>
            <span>{completed} of {steps.length} steps complete</span>
          </div>
          <ol aria-label="Getting started" className="divide-y divide-zinc-200">
            {steps.map((s, i) => (
              <li
                key={s.title}
                className="flex flex-wrap items-center justify-between gap-4 py-4"
              >
                <div className="flex min-w-0 basis-full gap-3 sm:basis-auto sm:flex-1">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-zinc-400 font-semibold" aria-hidden="true">{i + 1}</span>
                  <div>
                    <h3 className="text-base font-medium">{s.title}</h3>
                    <p className="mt-1 text-sm text-zinc-600">{s.benefit}</p>
                    <span className="text-sm font-medium">{s.done ? "Done" : "Open"}</span>
                  </div>
                </div>
                {!s.done && (
                  <Link href={s.href} className={buttonClass}>
                    {s.action}
                  </Link>
                )}
              </li>
            ))}
          </ol>
        </Card>
      )}
      <section aria-labelledby="week-title">
        <h2 id="week-title">This week</h2>
        <p className="mt-1 text-sm text-zinc-600">
          Monday–Sunday in each brand’s timezone. Counts are posts, including
          partial outcomes.
        </p>
        <div className="mt-4 grid grid-cols-3 gap-3">
          {Object.entries(counts).map(([label, n]) => (
            <Card key={label} className="!p-4">
              <p className="text-3xl font-semibold">{n}</p>
              <p className="mt-1 text-sm">{statusLabel(label)}</p>
            </Card>
          ))}
        </div>
      </section>
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <h2>Next up</h2>
          <ul className="divide-y divide-zinc-200">
            {next.map(({ post, brand }) => (
              <li key={post.id} className="space-y-2 py-4">
                <Link
                  className="line-clamp-2 font-medium hover:underline"
                  href={`/app/posts/${post.id}`}
                >
                  {post.body}
                </Link>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm">{brand.name}</span>
                  {targets
                    .filter((t) => t.postId === post.id)
                    .map((t) => (
                      <ProviderBadge key={t.target.id} provider={t.provider} />
                    ))}
                </div>
                <p className="text-sm text-zinc-600">
                  <time dateTime={post.scheduledAt!.toISOString()}>
                    {post.scheduledAt!.toLocaleString("en-US", {
                      timeZone: brand.timezone,
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </time>{" "}
                  · {brand.timezone}
                </p>
              </li>
            ))}
          </ul>
          {!next.length && (
            <div className="mt-4 space-y-3">
              <p>
                Your next scheduled posts will appear here. Let’s give your
                calendar something to look forward to.
              </p>
              <Link
                href="/app/posts/new"
                className="text-emerald-700 underline"
              >
                Schedule a post
              </Link>
            </div>
          )}
        </Card>
        <Card>
          <h2>Needs attention</h2>
          <p className="text-sm text-zinc-600">Up to 10 channel issues shown. <Link className="underline" href="/app/posts">View all posts</Link></p>
          <Link href="/app/channels" className="text-emerald-700 underline">Review channel health</Link>
          <ul className="divide-y divide-zinc-200">
            {expired.map((c) => (
              <li key={c.id} className="space-y-2 py-4">
                <p className="font-medium">
                  {c.brand} · {c.name}
                </p>
                <p className="text-sm">
                  Your channel’s access has expired. Reconnect it to resume
                  publishing.
                </p>
                <Link
                  href={`/app/brands/${c.brandId}#connect`}
                  className="text-emerald-700 underline"
                >
                  Reconnect {c.provider === 'x' ? 'X' : c.provider === 'threads' ? 'Threads' : 'channel'}
                </Link>
              </li>
            ))}
            {attention.map((r) => (
              <li key={r.target.id} className="space-y-2 py-4">
                <p className="font-medium">
                  {r.brand} · {r.channel}
                </p>
                <Badge>{statusLabel(r.target.status)}</Badge>
                <p className="text-sm">
                  {r.target.status === "needs_review"
                    ? "We couldn’t confirm delivery. Check the channel before retrying to avoid a duplicate."
                    : r.target.status === "held"
                      ? "Publishing is on hold. Review your plan and channel connection before retrying."
                      : "This channel could not publish the post. Review the issue and retry when it’s resolved."}
                </p>
                <Link
                  href={`/app/posts/${r.postId}`}
                  className="text-emerald-700 underline"
                >
                  Review post
                </Link>
              </li>
            ))}
          </ul>
          {!attention.length && !expired.length && (
            <p className="mt-4">
              You’re all caught up. Any publishing issues will appear here with
              a next step.
            </p>
          )}
        </Card>
      </div>
      <Card id="awaiting-approval">
        <h2>Awaiting approval</h2>
        <Link className="underline" href={"/app/posts?status=pending_approval" + (query.brand ? "&brand=" + encodeURIComponent(query.brand) : "")}>View all awaiting posts</Link>
        <div className="divide-y divide-zinc-200">
          {awaiting.map(({ post, brand }) => (
            <div key={post.id} className="space-y-3 py-4">
              <Link
                href={`/app/posts/${post.id}`}
                className="font-medium hover:underline"
              >
                {brand.name} · {post.body.slice(0, 100)}
              </Link>
              {origin &&
              post.approvalToken &&
              /^[A-Za-z0-9_-]{43}$/.test(post.approvalToken) ? (
                <CopyLink
                  postId={post.id}
                  link={`${origin.replace(/\/$/, "")}/r/${post.approvalToken}`}
                />
              ) : (
                <Link
                  href={`/app/posts/${post.id}`}
                  className="block text-emerald-700 underline"
                >
                  Open approval link
                </Link>
              )}
            </div>
          ))}
        </div>
        {!awaiting.length && (
          <p className="mt-4">
            No client feedback to chase. Select “Requires client approval” in
            the composer when you need a second pair of eyes.
          </p>
        )}
      </Card>
    </>
  );
}
