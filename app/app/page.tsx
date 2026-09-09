import Link from "next/link";
import { eq, and, asc } from "drizzle-orm";
import { brands, channels, posts, postTargets, postEvents } from "@/db/schema";
import { coreContext } from "@/lib/core";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { workspaceEntitlements } from "@/lib/entitlements";
import { CopyLink } from "@/components/approvals/copy-link";
import { ProviderBadge } from "@/components/app/provider-badge";
import { inZone } from "@/lib/timezone";
export default async function Overview({
  searchParams,
}: {
  searchParams: Promise<{ brand?: string; checkout?: string }>;
}) {
  const { db, workspace } = await coreContext(),
    query = await searchParams;
  const [bs, rows, cs, targets, shared] = await Promise.all([
    db
      .select()
      .from(brands)
      .where(eq(brands.workspaceId, workspace.id))
      .orderBy(asc(brands.createdAt)),
    db
      .select({ post: posts, brand: brands })
      .from(posts)
      .innerJoin(brands, eq(posts.brandId, brands.id))
      .where(eq(brands.workspaceId, workspace.id)),
    db
      .select({
        id: channels.id,
        brandId: channels.brandId,
        provider: channels.provider,
        name: channels.displayName,
        status: channels.status,
        brand: brands.name,
      })
      .from(channels)
      .innerJoin(brands, eq(channels.brandId, brands.id))
      .where(eq(brands.workspaceId, workspace.id)),
    db
      .select({
        target: postTargets,
        postId: posts.id,
        brandId: brands.id,
        brand: brands.name,
        channel: channels.displayName,
        provider: channels.provider,
      })
      .from(postTargets)
      .innerJoin(posts, eq(postTargets.postId, posts.id))
      .innerJoin(brands, eq(posts.brandId, brands.id))
      .innerJoin(channels, eq(postTargets.channelId, channels.id))
      .where(eq(brands.workspaceId, workspace.id)),
    db
      .select({ id: postEvents.id })
      .from(postEvents)
      .innerJoin(posts, eq(postEvents.postId, posts.id))
      .innerJoin(brands, eq(posts.brandId, brands.id))
      .where(
        and(
          eq(brands.workspaceId, workspace.id),
          eq(postEvents.type, "approval_link_copied"),
        ),
      )
      .limit(1),
  ]);
  const access = await workspaceEntitlements(workspace);
  const brandUrl = bs[0] ? `/app/brands/${bs[0].id}#connect` : "/app/brands";
  const steps = [
    {
      title: "Create your first brand",
      benefit: "Keep each client’s content and channels together.",
      done: bs.length > 0,
      href: "/app/brands",
      action: "Create brand",
    },
    {
      title: "Connect a channel",
      benefit: "Publish to Bluesky, Mastodon or Telegram from one place.",
      done: cs.some((c) => c.status !== "disconnected"),
      href: brandUrl,
      action: "Connect channel",
    },
    {
      title: "Schedule your first post",
      benefit: "Choose a time and let SocialMint handle the publishing.",
      done: rows.some((r) => !!r.post.scheduledAt && r.post.status !== "draft"),
      href: "/app/posts/new",
      action: "Schedule post",
    },
    {
      title: "Share an approval link with a client",
      benefit:
        "Copy a client approval link, then send it for feedback without a login. Included with Agency.",
      done: shared.length > 0,
      href: !access.approvalLinks ? "/app/billing" : rows.find((r) => r.post.status === "pending_approval")
        ? "#awaiting-approval"
        : "/app/posts/new",
      action: access.approvalLinks ? "Prepare approval link" : "Included with Agency — upgrade",
    },
  ];
  const completed = steps.filter((s) => s.done).length;
  const visible = rows.filter(
    (r) => !query.brand || r.brand.id === query.brand,
  );
  const next = visible
    .filter(
      (r) =>
        ["scheduled", "approved"].includes(r.post.status) &&
        r.post.scheduledAt &&
        r.post.scheduledAt > new Date(),
    )
    .sort((a, b) => +a.post.scheduledAt! - +b.post.scheduledAt!)
    .slice(0, 5);
  const attention = targets.filter(
    (r) =>
      (!query.brand || r.brandId === query.brand) &&
      ["failed", "needs_review", "held"].includes(r.target.status),
  );
  const expired = cs.filter(
    (c) =>
      (!query.brand || c.brandId === query.brand) &&
      c.status === "token_expired",
  );
  const awaiting = visible.filter((r) => r.post.status === "pending_approval");
  function thisWeek(date: Date | null, timezone: string) {
    if (!date) return false;
    const today = new Date(
      inZone(new Date(), timezone).slice(0, 10) + "T12:00:00Z",
    );
    today.setUTCDate(today.getUTCDate() - ((today.getUTCDay() + 6) % 7));
    const end = new Date(today);
    end.setUTCDate(end.getUTCDate() + 7);
    const day = inZone(date, timezone).slice(0, 10);
    return (
      day >= today.toISOString().slice(0, 10) &&
      day < end.toISOString().slice(0, 10)
    );
  }
  const counts = {
    scheduled: visible.filter(
      (r) =>
        ["scheduled", "approved"].includes(r.post.status) &&
        thisWeek(r.post.scheduledAt, r.brand.timezone),
    ).length,
    published: visible.filter((r) =>
      targets.some(
        (t) =>
          t.postId === r.post.id &&
          t.target.status === "published" &&
          thisWeek(t.target.publishedAt, r.brand.timezone),
      ),
    ).length,
    failed: visible.filter((r) =>
      targets.some(
        (t) =>
          t.postId === r.post.id &&
          t.target.status === "failed" &&
          thisWeek(t.target.updatedAt, r.brand.timezone),
      ),
    ).length,
  };
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
      {completed < 4 && (
        <Card aria-labelledby="onboarding-title">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="onboarding-title">Make yourself at home</h2>
            <Badge>{completed}/4 complete</Badge>
          </div>
          <div
            role="progressbar"
            aria-label="Getting started"
            aria-valuemin={0}
            aria-valuemax={4}
            aria-valuenow={completed}
            className="my-4 h-2 overflow-hidden rounded-full bg-zinc-200"
          >
            <div
              className="h-full bg-emerald-700"
              style={{ width: `${completed * 25}%` }}
            />
          </div>
          <ol className="divide-y divide-zinc-200">
            {steps.map((s, i) => (
              <li
                key={s.title}
                className="flex flex-wrap items-center justify-between gap-4 py-4"
              >
                <div className="flex min-w-0 basis-full gap-3 sm:basis-auto sm:flex-1">
                  <span
                    aria-hidden="true"
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-800"
                  >
                    {s.done ? "✓" : i + 1}
                  </span>
                  <div>
                    <h3 className="text-base font-medium">{s.title}</h3>
                    <p className="mt-1 text-sm text-zinc-600">{s.benefit}</p>
                    <span className="text-xs text-zinc-600">
                      {s.done ? "Complete" : "Pending"}
                    </span>
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
              <p className="mt-1 text-sm capitalize">{label}</p>
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
                  Reconnect channel
                </Link>
              </li>
            ))}
            {attention.map((r) => (
              <li key={r.target.id} className="space-y-2 py-4">
                <p className="font-medium">
                  {r.brand} · {r.channel}
                </p>
                <Badge>{r.target.status.replaceAll("_", " ")}</Badge>
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
