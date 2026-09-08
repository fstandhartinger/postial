"use server";
import { revalidatePath } from "next/cache";
import { ownPost } from "@/lib/core";
import { rotateApprovalLink } from "@/lib/approvals";
export async function regenerateApprovalLink(postId: string) {
  const { workspace } = await ownPost(postId);
  await rotateApprovalLink(postId, workspace.id);
  revalidatePath("/app", "layout");
}
