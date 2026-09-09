"use server";
import { eq, and } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { ownPost } from "@/lib/core";
import { postEvents } from "@/db/schema";
export async function recordApprovalCopy(postId: string) {
  const { db, post } = await ownPost(postId);
  if (!post.requiresApproval || !post.approvalToken || post.status === "draft")
    return;
  await db.transaction(async (tx) => {
    const { posts } = await import("@/db/schema");
    await tx
      .select({ id: posts.id })
      .from(posts)
      .where(eq(posts.id, postId))
      .for("update");
    const existing = await tx
      .select({ id: postEvents.id })
      .from(postEvents)
      .where(
        and(
          eq(postEvents.postId, postId),
          eq(postEvents.type, "approval_link_copied"),
        ),
      )
      .limit(1);
    if (!existing.length)
      await tx
        .insert(postEvents)
        .values({
          postId,
          type: "approval_link_copied",
          message: "Client approval link copied for sharing",
        });
  });
  revalidatePath("/app");
}
