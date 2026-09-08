import Link from "next/link";
import { eq, asc } from "drizzle-orm";
import { channels, postTargets, postEvents } from "@/db/schema";
import { ownPost } from "@/lib/core";
import { Card } from "@/components/ui/card";
import { ActionForm } from "@/components/core/forms";
export default async function PostPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { db, post, brand } = await ownPost((await params).id);
  const targets = await db
    .select({ target: postTargets, name: channels.displayName })
    .from(postTargets)
    .innerJoin(channels, eq(channels.id, postTargets.channelId))
    .where(eq(postTargets.postId, post.id));
  const events = await db
    .select()
    .from(postEvents)
    .where(eq(postEvents.postId, post.id))
    .orderBy(asc(postEvents.createdAt));
  const editable = ["draft", "pending_approval", "changes_requested"].includes(
    post.status,
  );
  return (
    <>
      <h1 className="text-3xl font-semibold">Post status</h1>
      <p>
        {brand.name} · {post.status.replaceAll("_", " ")}
      </p>
      <Card>
        <p className="whitespace-pre-wrap break-words">{post.body}</p>
        {editable && (
          <Link
            className="mt-4 block text-emerald-700 underline"
            href={`/app/posts/${post.id}/edit`}
          >
            Edit post
          </Link>
        )}
      </Card>
      {targets.map(({ target: t, name }) => (
        <Card key={t.id}>
          <h2 className="text-xl font-semibold">{name}</h2>
          <p>
            {t.status} · {t.attempts} attempts
          </p>
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
          {!editable && ["queued", "failed"].includes(t.status) && (
            <div className="mt-4 flex gap-6">
              {(t.status === "failed" || t.lastErrorCode) && (
                <ActionForm action="retry">
                  <input type="hidden" name="targetId" value={t.id} />
                  <p>Retry now</p>
                </ActionForm>
              )}
              <ActionForm action="skip">
                <input type="hidden" name="targetId" value={t.id} />
                <p>Skip channel</p>
              </ActionForm>
            </div>
          )}
        </Card>
      ))}
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
