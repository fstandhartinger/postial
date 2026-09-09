import Link from "next/link";
import { eq } from "drizzle-orm";
import { postTargets } from "@/db/schema";
import { ownPost, composerData } from "@/lib/core";
import { channelTextLimit } from "@/lib/text-limits";
import { Composer } from "@/components/core/composer";
import { inZone } from "@/lib/timezone";
export default async function EditPost({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { db, post, brand } = await ownPost((await params).id);
  if (!["draft", "pending_approval", "changes_requested"].includes(post.status))
    return (
      <p>
        This post is already scheduled.{" "}
        <Link href={`/app/posts/${post.id}`}>View status</Link>
      </p>
    );
  const data = await composerData(),
    targets = await db
      .select()
      .from(postTargets)
      .where(eq(postTargets.postId, post.id));
  return (
    <>
      <h1 className="text-3xl font-semibold">Edit post</h1>
      <Composer
        canPublish={data.canPublish} approvalLinks={data.approvalLinks}
        brands={data.brands}
        channels={data.channels.map((c) => ({
          ...c,
          max: channelTextLimit(c),
        }))}
        initial={{
          ...post,
          linkUrl: post.linkUrl ?? undefined,
          scheduledAt: post.scheduledAt
            ? inZone(post.scheduledAt, brand.timezone)
            : undefined,
          channelIds: targets.map((t) => t.channelId),
        }}
      />
    </>
  );
}
