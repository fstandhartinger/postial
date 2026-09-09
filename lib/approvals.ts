import { emit } from "@/lib/api/webhooks";
import { createHmac, randomBytes } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { approvalDecisions, approvalRateLimits, brands, channels, posts, postEvents, postTargets } from "@/db/schema";

export const newApprovalToken = () => randomBytes(32).toString("base64url");
export const approvalInput = z.object({
  reviewerName: z.string().trim().min(1, "Enter your name.").max(80, "Name must be at most 80 characters."),
  comment: z.string().trim().max(1000, "Comment must be at most 1000 characters."),
  decision: z.enum(["approved", "changes_requested"]),
}).refine((v) => v.decision !== "changes_requested" || v.comment.length > 0, {
  message: "Please describe the changes you need.", path: ["comment"],
});
export function canReview(status: string) {
  return ["pending_approval", "changes_requested", "approved"].includes(status);
}
const validToken = (token: string) => /^[A-Za-z0-9_-]{43}$/.test(token);
export async function publicApproval(token: string) {
  if (!validToken(token)) return null;
  const db = getDb();
  const [row] = await db.select({
    postId: posts.id, body: posts.body, mediaUrls: posts.mediaUrls, linkUrl: posts.linkUrl,
    scheduledAt: posts.scheduledAt, status: posts.status, name: brands.name,
    color: brands.color, timezone: brands.timezone,
  }).from(posts).innerJoin(brands, eq(brands.id, posts.brandId))
    .where(and(eq(posts.approvalToken, token), eq(posts.requiresApproval, true)));
  if (!row) return null;
  const targets = await db.select({ provider: channels.provider, name: channels.displayName, status: postTargets.status, attempts: postTargets.attempts })
    .from(postTargets).innerJoin(channels, eq(channels.id, postTargets.channelId))
    .where(eq(postTargets.postId, row.postId));
  const [lastDecision] = await db.select({ decision: approvalDecisions.decision,
    comment: approvalDecisions.comment, name: approvalDecisions.reviewerName, at: approvalDecisions.createdAt })
    .from(approvalDecisions).where(eq(approvalDecisions.postId, row.postId))
    .orderBy(desc(approvalDecisions.createdAt)).limit(1);
  const { postId: internalId, ...visible } = row;
  void internalId;
  return { ...visible, targets: targets.map(({ provider, name }) => ({ provider, name })), lastDecision,
    reviewable: canReview(row.status) && targets.every((t) => t.status !== "publishing" && t.status !== "published" && t.attempts === 0) };
}
export type PublicApproval = NonNullable<Awaited<ReturnType<typeof publicApproval>>>;
export type ApprovalResult = { status: number; error?: string; decision?: "approved" | "changes_requested" };

export async function decideApproval(token: string, input: unknown, ip: string): Promise<ApprovalResult> {
  if (!validToken(token)) return { status: 404 };
  // AUTH_SECRET salts IP hashes, preventing dictionary recovery of client addresses.
  const secret = process.env.AUTH_SECRET;
  if (!secret) return { status: 503, error: "Please try again later." };
  const digest = (value: string) => createHmac("sha256", secret).update(value).digest("hex");
  return getDb().transaction(async (tx) => {
    const [post] = await tx.select().from(posts)
      .where(and(eq(posts.approvalToken, token), eq(posts.requiresApproval, true))).for("update");
    if (!post) return { status: 404 };
    const key = digest(`${token}\0${ip}`);
    const [limit] = await tx.insert(approvalRateLimits).values({ key, postId: post.id, expiresAt: new Date(Date.now() + 3600000) })
      .onConflictDoUpdate({ target: approvalRateLimits.key, set: {
        attempts: sql`case when ${approvalRateLimits.expiresAt} <= now() then 1 else ${approvalRateLimits.attempts} + 1 end`,
        expiresAt: sql`case when ${approvalRateLimits.expiresAt} <= now() then now() + interval '1 hour' else ${approvalRateLimits.expiresAt} end`,
      } }).returning();
    if (limit.attempts > 10) return { status: 429, error: "Too many decisions. Please try again in one hour." };
    const parsed = approvalInput.safeParse(input);
    if (!parsed.success) return { status: 400, error: parsed.error.issues[0].message };
    // Worker locks targets when claiming. Lock them too before checking whether a
    // claim has begun, so a late review cannot revoke content already in flight.
    const targets = await tx.select().from(postTargets).where(eq(postTargets.postId, post.id)).for("update");
    if (!canReview(post.status) || targets.some((t) => t.status === "publishing" || t.status === "published" || t.attempts > 0))
      return { status: 409, error: "Publishing has started. This post is now read-only." };
    const { reviewerName, comment, decision } = parsed.data;
    const [savedDecision] = await tx.insert(approvalDecisions).values({ postId: post.id, decision, comment, reviewerName, reviewerIpHash: digest(ip), createdAt: sql`clock_timestamp()` }).returning({at: approvalDecisions.createdAt});
    await tx.update(posts).set({ status: decision, approvalNote: comment, updatedAt: new Date() }).where(eq(posts.id, post.id));
    // Matches agency scheduling and tick's held-target activation, without running
    // publishing/network work inside a customer request.
    await tx.update(postTargets).set({ nextAttemptAt: decision === "approved" ? post.scheduledAt : null, updatedAt: new Date() })
      .where(and(eq(postTargets.postId, post.id), eq(postTargets.status, "queued")));
    await tx.insert(postEvents).values({ postId: post.id, type: decision,
      message: `Client ${reviewerName} ${decision === "approved" ? "approved" : "requested changes"}${comment ? `: ${comment}` : ""}` });
    // API outbox commits atomically with the customer decision and post history.
    await emit(tx, post.id, "approval.decided", {decision, decided_at: savedDecision.at.toISOString(), has_comment: !!comment});
    return { status: 200, decision };
  });
}

/** Called only after workspace authorization by the agency server action. */
export async function rotateApprovalLink(postId: string, workspaceId: string, legacyOnly = false) {
  return getDb().transaction(async (tx) => {
    const [row] = await tx.select({ post: posts }).from(posts).innerJoin(brands, eq(posts.brandId, brands.id))
      .where(and(eq(posts.id, postId), eq(brands.workspaceId, workspaceId))).for("update", { of: posts });
    if (!row || !row.post.requiresApproval || !canReview(row.post.status)) return false;
    if (legacyOnly && row.post.approvalToken && validToken(row.post.approvalToken)) return true;
    await tx.update(posts).set({ approvalToken: newApprovalToken(), updatedAt: new Date() }).where(eq(posts.id, postId));
    await tx.insert(postEvents).values({ postId, type: "approval_link_regenerated", message: "Client approval link regenerated; previous link revoked" });
    return true;
  });
}
