"use server";
import { revalidatePath } from "next/cache";
import { workspaceEntitlements } from "@/lib/entitlements";
import { ownPost } from "@/lib/core";
import { rotateApprovalLink } from "@/lib/approvals";
export async function regenerateApprovalLink(postId: string) {
  const { workspace, brand } = await ownPost(postId);
  const access = await workspaceEntitlements(workspace);
  if (!access.approvalLinks || !access.activeBrandIds.includes(brand.id)) return;
  await rotateApprovalLink(postId, workspace.id);
  revalidatePath("/app", "layout");
}
