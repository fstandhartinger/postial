import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { approvalDecisions, posts } from "@/db/schema";
import { ownPost } from "@/lib/core";
import { canReview, rotateApprovalLink } from "@/lib/approvals";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CopyLink } from "./copy-link";
import { regenerateApprovalLink } from "./actions";
export async function ApprovalPanel({ post }: { post: typeof posts.$inferSelect }) {
  if (!post.requiresApproval || post.status === "draft") return null;
  // Upgrade the legacy composer UUID before displaying any public capability.
  if (!post.approvalToken || !/^[A-Za-z0-9_-]{43}$/.test(post.approvalToken)) {
    const { workspace } = await ownPost(post.id);
    await rotateApprovalLink(post.id, workspace.id, true);
    const [updated] = await getDb().select().from(posts).where(eq(posts.id, post.id));
    post = updated;
  }
  const history = await getDb().select().from(approvalDecisions).where(eq(approvalDecisions.postId, post.id)).orderBy(desc(approvalDecisions.createdAt));
  const origin = process.env.NEXT_PUBLIC_APP_URL || process.env.AUTH_URL;
  return <Card>
    <h2 className="text-xl font-semibold">Client approval</h2>
    <p>{post.status === "pending_approval" ? "Awaiting approval" : post.status.replaceAll("_", " ")}</p>
    <p>Send this link to your client — no login needed.</p>
    {origin && post.approvalToken ? <CopyLink link={`${origin.replace(/\/$/, "")}/r/${post.approvalToken}`} /> : <p>Set NEXT_PUBLIC_APP_URL to share approval links.</p>}
    {canReview(post.status) && <form className="mt-4" action={regenerateApprovalLink.bind(null, post.id)}><Button>Regenerate link</Button></form>}
    <ol className="mt-4 space-y-3">{history.map((d) => <li key={d.id}>
      <p>{d.reviewerName} {d.decision.replaceAll("_", " ")} · {d.createdAt.toLocaleString("en-GB", { timeZone: "UTC" })} UTC</p>
      {d.comment && <p className="whitespace-pre-wrap break-words">{d.comment}</p>}
    </li>)}</ol>
  </Card>;
}
