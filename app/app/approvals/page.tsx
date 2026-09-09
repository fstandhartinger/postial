import {statusLabel} from "@/lib/status-label";
import Link from 'next/link';
import { eq } from 'drizzle-orm';
import { brands } from '@/db/schema';
import { coreContext, isUuid } from '@/lib/core';
import { workspaceEntitlements } from '@/lib/entitlements';
import { listApprovals, canReview } from '@/lib/approvals';
import { regenerateApprovalLink } from '@/components/approvals/actions';
import { CopyLink } from '@/components/approvals/copy-link';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/input';
export default async function ApprovalsPage({searchParams}:{searchParams:Promise<{brand?:string}>}) {
  const {db,workspace} = await coreContext(), q = await searchParams;
  const access = await workspaceEntitlements(workspace);
  if (!access.approvalLinks) return <><h1>Approvals</h1><Link href="/docs/approvals" target="_blank" rel="noopener noreferrer" aria-label="Approvals help (opens in a new tab)" title="Approvals help" className="inline-flex h-8 w-8 items-center justify-center rounded-full border text-sm">?</Link><Card><h2>Client approvals are included with Agency</h2><p>Collect feedback and approve posts before publishing.</p><Link className="underline" href="/app/billing">Upgrade to Agency</Link></Card></>;
  const bs = await db.select().from(brands).where(eq(brands.workspaceId,workspace.id));
  const groups = await listApprovals(workspace.id,q.brand && isUuid(q.brand) ? q.brand : undefined);
  const origin = process.env.NEXT_PUBLIC_APP_URL || process.env.AUTH_URL;
  return <><h1>Approvals</h1><Link href="/docs/approvals" target="_blank" rel="noopener noreferrer" aria-label="Approvals help (opens in a new tab)" title="Approvals help" className="inline-flex h-8 w-8 items-center justify-center rounded-full border text-sm">?</Link><p className="text-zinc-600">Client decisions across your brands. Drafts await sharing; publishing progress appears under Approved.</p>
    <form className="flex flex-wrap gap-3"><Select aria-label="Filter brand" name="brand" defaultValue={q.brand}><option value="">All brands</option>{bs.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</Select><Button variant="secondary">Filter</Button></form>
    {groups.map(({group,rows})=><section key={group} aria-label={group} className="space-y-4"><h2>{group} ({rows.length})</h2>
      {!rows.length && <Card><p>No posts in this group.</p></Card>}
      {rows.map(({post:p,brand:b,lastDecision:d})=><Card key={p.id} className="min-w-0 space-y-3">
        <Link className="block break-words font-semibold underline" href={`/app/posts/${p.id}`}>{b.name} · {p.body.slice(0,160)}</Link>
        <p>Status: {statusLabel(p.status)}</p><p>Scheduled: {p.scheduledAt ? p.scheduledAt.toLocaleString('en-GB',{timeZone:b.timezone})+' '+b.timezone : 'Not scheduled'}</p>
        {d ? <div><p>Last decision: {d.decision.replaceAll('_',' ')} · {new Date(d.at).toLocaleString('en-GB',{timeZone:b.timezone})}</p><p className="whitespace-pre-wrap break-words">{d.comment || 'No comment'}</p></div> : <p>No client decision yet.</p>}
        {p.approvalToken && /^[A-Za-z0-9_-]{43}$/.test(p.approvalToken) && origin ? <CopyLink postId={p.id} link={`${origin.replace(/\/$/,'')}/r/${p.approvalToken}`}/> : <p>Save an approval request to create a shareable link.</p>}
        <form action={regenerateApprovalLink.bind(null,p.id)}><Button disabled={!canReview(p.status) || !access.activeBrandIds.includes(b.id)}>Regenerate link</Button></form>
      </Card>)}
    </section>)}
  </>;
}
