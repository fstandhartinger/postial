import Link from 'next/link';
import {eq,and} from 'drizzle-orm';
import {revalidatePath} from 'next/cache';
import {coreContext} from '@/lib/core';
import {dpaAcceptances,users} from '@/db/schema';
import {acceptDpa,dpaVersion} from '@/lib/dpa';
export default async function LegalSettings(){
  const {db,workspace,role}=await coreContext();
  const [accepted]=await db.select({date:dpaAcceptances.acceptedAt,version:dpaAcceptances.version,hash:dpaAcceptances.documentHash,userId:dpaAcceptances.userId,name:users.name}).from(dpaAcceptances).leftJoin(users,eq(users.id,dpaAcceptances.userId)).where(and(eq(dpaAcceptances.workspaceId,workspace.id),eq(dpaAcceptances.version,dpaVersion)));
  async function accept(){'use server';const ctx=await coreContext();await acceptDpa(ctx.workspace.id,ctx.userId);revalidatePath('/app/settings/legal');}
  return <><h1 className="text-3xl font-semibold">Legal &amp; DPA</h1><p><Link className="underline" href="/legal/dpa" target="_blank">Read and print the Data Processing Agreement</Link> · Version {dpaVersion}</p><p>Workspace: {workspace.name}. By accepting, you confirm authority to bind the customer associated with this workspace.</p>{accepted?<section className="space-y-2 rounded border p-4"><h2>DPA accepted</h2><p>{accepted.date.toISOString()} (UTC) · {accepted.name || accepted.userId || 'Former workspace owner'}</p><p>Version {accepted.version}</p><p className="break-all text-sm">Document SHA-256: {accepted.hash}</p></section>:role==='owner'?<form action={accept}><button className="rounded bg-emerald-700 px-4 py-3 text-white">Accept DPA</button></form>:<p>Ask the workspace owner to accept the DPA.</p>}<p><Link href="/app/settings/notifications">Notification settings</Link> · <Link href="/privacy">Privacy Policy</Link></p></>;
}
