import { statusLabel } from '@/lib/status-label';
import { inZone } from '@/lib/timezone';
import { workspaceEntitlements } from "@/lib/entitlements";
import Link from "next/link";
import { ApprovalPanel } from "@/components/approvals/panel";
import { PostMetrics, type TargetMetricsView } from "@/components/app/post-metrics";
import { eq, asc } from "drizzle-orm";
import { channels, postTargets, postEvents, postMetrics } from "@/db/schema";
import { ownPost } from "@/lib/core";
import { getPublisher } from "@/lib/publishers";
import { Card } from "@/components/ui/card";
import { ActionForm } from "@/components/core/forms";
export default async function PostPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { db, post, brand, workspace } = await ownPost((await params).id);
  const access = await workspaceEntitlements(workspace);
  const writable = access.activeBrandIds.includes(brand.id);
  const targets = await db
    .select({ target: postTargets, name: channels.displayName, channelStatus: channels.status, provider: channels.provider })
    .from(postTargets)
    .innerJoin(channels, eq(channels.id, postTargets.channelId))
    .where(eq(postTargets.postId, post.id));
  const events = await db
    .select()
    .from(postEvents)
    .where(eq(postEvents.postId, post.id))
    .orderBy(asc(postEvents.createdAt));
  const metricRows = await db
    .select({
      targetId: postMetrics.targetId,
      fetchedAt: postMetrics.fetchedAt,
      outcome: postMetrics.outcome,
      likes: postMetrics.likes,
      replies: postMetrics.replies,
      reposts: postMetrics.reposts,
      quotes: postMetrics.quotes,
      impressions: postMetrics.impressions,
    })
    .from(postMetrics)
    .innerJoin(postTargets, eq(postTargets.id, postMetrics.targetId))
    .where(eq(postTargets.postId, post.id))
    .orderBy(asc(postMetrics.fetchedAt));
  const metricsByTarget = new Map<string, typeof metricRows>();
  for (const row of metricRows) {
    const list = metricsByTarget.get(row.targetId) ?? [];
    list.push(row);
    metricsByTarget.set(row.targetId, list);
  }
  const targetMetrics: TargetMetricsView[] = targets.map(({ target: t, name, provider }) => {
    const rows = metricsByTarget.get(t.id) ?? [];
    const latestRow = rows[rows.length - 1];
    const values = (row: (typeof metricRows)[number]) => ({
      likes: row.likes,
      replies: row.replies,
      reposts: row.reposts,
      quotes: row.quotes,
      impressions: row.impressions,
    });
    return {
      targetId: t.id,
      channelName: name,
      reportsMetrics: Boolean(getPublisher(provider).fetchMetrics),
      provider,
      published: t.status === "published",
      latest: latestRow ? { outcome: latestRow.outcome, fetchedAt: latestRow.fetchedAt, values: values(latestRow) } : null,
      points: rows.filter((r) => r.outcome === "ok").map((r) => ({ fetchedAt: r.fetchedAt, values: values(r) })),
    };
  });
  const editable = ["draft", "pending_approval", "changes_requested", "scheduled", "approved"].includes(
    post.status,
  ) && !targets.some(({target:t}) => t.attempts > 0 || ["publishing", "published"].includes(t.status));
  const reschedulable = ["scheduled","approved"].includes(post.status) && !targets.some(({target:t}) => ["publishing","published"].includes(t.status));
  return (
    <>
      <h1 className="text-3xl font-semibold">Post status</h1>
      <ActionForm action="duplicate" disabled={!writable}><input type="hidden" name="postId" value={post.id}/></ActionForm>
      <p>
        {brand.name} · {statusLabel(post.status)}
        {post.status === "published" &&
          targets.some((r) => r.target.warnings.length) && (
            <span className="ml-2 rounded bg-amber-100 p-2 text-amber-900">
              Published with warnings
            </span>
          )}
      </p>
      <p
        role="status"
        className={`rounded-xl p-4 ${["failed","partially_failed"].includes(post.status) ? "bg-amber-50 text-amber-900" : "bg-emerald-50 text-emerald-800"}`}
      >
        {post.status === "draft"
          ? "Draft saved. Keep shaping it, then schedule when you’re ready."
          : post.status === "scheduled" && post.scheduledAt
            ? `Post scheduled for ${post.scheduledAt.toLocaleString("en-US", { timeZone: brand.timezone, dateStyle: "medium", timeStyle: "short" })} (${brand.timezone}).`
            : post.status === "pending_approval"
              ? "Post saved for client approval. Copy the link below to share it."
            : post.status === "failed" || post.status === "partially_failed"
              ? "Publishing did not finish for one or more channels. Review the channel messages below and retry when you are ready."
              : `${statusLabel(post.status)}.`}
      </p>
      <Card>
        <p className="whitespace-pre-wrap break-words">{post.body}</p>
        {editable && writable && (
          <Link
            className="mt-4 block text-emerald-700 underline"
            href={`/app/posts/${post.id}/edit`}
          >
            Edit post
          </Link>
        )}
      </Card>
      {reschedulable && writable && <Card><ActionForm action="reschedule" disabled={!access.publish}><input type="hidden" name="postId" value={post.id}/><label className="block">New date and time ({brand.timezone})<input className="block rounded border p-3" type="datetime-local" name="scheduledAt" required defaultValue={post.scheduledAt ? inZone(post.scheduledAt,brand.timezone) : undefined}/></label><p>Changing only the date preserves client approval.</p></ActionForm></Card>}
      <ApprovalPanel post={post} />
      <PostMetrics targets={targetMetrics} now={new Date()} />
      {targets.map(({ target: t, name, channelStatus }) => (
        <Card key={t.id}>
          <h2 className="text-xl font-semibold">{name}</h2>
          <p>
            {statusLabel(t.status)} · Tried {t.attempts} of 5 times
          </p>
          {t.warnings.map((warning, index) => (
            <p
              key={index}
              role="status"
              className="rounded bg-amber-50 p-3 text-amber-900"
            >
              {warning} Check the published post and add missing content
              manually; retrying could duplicate it.
            </p>
          ))}
          {t.status === 'held' && <Link className="inline-block rounded border px-3 py-2" href="/app/billing">Update billing</Link>}
          {channelStatus !== 'active' && <Link className="inline-block rounded border px-3 py-2" href={`/app/brands/${brand.id}#connect`}>Reconnect channel</Link>}
          {t.lastErrorHuman && (
            <p role="status" className="mt-2 text-red-700">
              {t.lastErrorHuman}
            </p>
          )}
          {t.nextAttemptAt && (
            <p>
              Next attempt:{" "}
              {t.nextAttemptAt.toLocaleString("en-GB", {
                timeZone: brand.timezone,
              })}{" "}
              ({brand.timezone})
            </p>
          )}
          {t.remoteUrl && /^https:\/\//.test(t.remoteUrl) && (
            <a
              className="text-emerald-700 underline"
              href={t.remoteUrl}
              target="_blank"
              rel="noreferrer"
            >
              View published post
            </a>
          )}
          {!["draft","pending_approval","changes_requested"].includes(post.status) &&
            ["queued", "failed", "needs_review", "held"].includes(t.status) && (
              <div className="mt-4 flex gap-6">
                {(["failed", "needs_review", "held"].includes(t.status) ||
                  t.lastErrorCode) && (
                  <ActionForm
                    action="retry"
                    disabled={!access.publish || !writable || channelStatus !== "active"}
                  >
                    <input type="hidden" name="targetId" value={t.id} />

                  </ActionForm>
                )}
                <ActionForm action="skip" disabled={!writable}>
                  <input type="hidden" name="targetId" value={t.id} />

                </ActionForm>
              </div>
            )}
        </Card>
      ))}
      {(!access.publish || !writable) && (
        <p>
          Publishing is unavailable under your current plan.{" "}
          <Link href="/app/billing" className="underline">
            Review Billing
          </Link>
        </p>
      )}
      <h2 className="text-xl font-semibold">History</h2>
      <ol className="space-y-4 border-l-2 border-emerald-100 pl-5">
        {events.map((e) => (
          <li key={e.id}>
            <p>{e.message}</p>
            <time className="text-sm text-gray-500">
              {e.createdAt.toLocaleString("en-GB", {
                timeZone: brand.timezone,
              })}
            </time>
          </li>
        ))}
      </ol>
    </>
  );
}
