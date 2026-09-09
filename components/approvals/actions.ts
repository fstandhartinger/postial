"use server";
import { sessionActionBudget } from '@/lib/rate-limit';
import { revalidatePath } from "next/cache";
import { workspaceEntitlements } from "@/lib/entitlements";
import { ownPost } from "@/lib/core";
import { rotateApprovalLink } from "@/lib/approvals";
export async function regenerateApprovalLink(postId: string) {
  const { workspace, brand, userId } = await ownPost(postId);
  await sessionActionBudget(userId);
  const access = await workspaceEntitlements(workspace);
  if (!access.approvalLinks || !access.activeBrandIds.includes(brand.id)) return;
  await rotateApprovalLink(postId, workspace.id);
  revalidatePath("/app", "layout");
}
