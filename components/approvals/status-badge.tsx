import { Badge } from "@/components/ui/badge";
export function ApprovalStatusBadge({ post }: { post: { status: string; approvalNote: string | null } }) {
  if (!["pending_approval", "changes_requested"].includes(post.status)) return null;
  return <div className="mt-2">
    <Badge>{post.status === "pending_approval" ? "Awaiting approval" : "Changes requested"}</Badge>
    {post.approvalNote && <p className="mt-1 line-clamp-2 break-words text-sm">{post.approvalNote.slice(0, 180)}</p>}
  </div>;
}
