import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { users, workspaces, workspaceMembers, subscriptions, brands, channels, posts, postTargets, postEvents, approvalDecisions, verificationTokens, networkWaitlist } from '@/db/schema';
import { billingState } from '@/db/billing-schema';
import { mediaAssets } from '@/db/media-schema';
import { ApiError } from '@/lib/api/errors';
import { stripe } from '@/lib/stripe';
import { lockWorkspace } from '@/lib/billing';
import type { Tx } from '@/lib/api/post-service';
async function owner(tx: Tx, workspaceId: string, actor: string) {
  const [ws] = await tx.select().from(workspaces).where(eq(workspaces.id,workspaceId)).for('update');
  const [member] = await tx.select().from(workspaceMembers).where(and(eq(workspaceMembers.workspaceId,workspaceId),eq(workspaceMembers.userId,actor)));
  if (!ws || member?.role !== 'owner') throw new ApiError(403,'forbidden','Only a workspace owner can do this.');
  return ws;
}
export async function transferOwnership(workspaceId: string, actor: string, target: string) {
  if (target === actor) throw new ApiError(422,'validation_error','Choose another member.');
  return getDb().transaction(async tx => {
    await owner(tx,workspaceId,actor);
    const [member] = await tx.select().from(workspaceMembers).where(and(eq(workspaceMembers.workspaceId,workspaceId),eq(workspaceMembers.userId,target)));
    if (!member) throw new ApiError(422,'validation_error','Choose a current workspace member.');
    await tx.update(workspaceMembers).set({role:'owner'}).where(and(eq(workspaceMembers.workspaceId,workspaceId),eq(workspaceMembers.userId,target)));
    await tx.update(workspaces).set({ownerUserId:target}).where(eq(workspaces.id,workspaceId));
    await tx.update(workspaceMembers).set({role:'editor'}).where(and(eq(workspaceMembers.workspaceId,workspaceId),eq(workspaceMembers.userId,actor)));
    await tx.execute(sql`insert into offboarding_events (workspace_id, event) values (${workspaceId}::uuid, 'ownership_transferred')`);
  });
}
export async function exportWorkspace(workspaceId: string, actor: string) {
  return getDb().transaction(async tx => {
    await tx.execute(sql`set transaction isolation level repeatable read`);
    const ws = await owner(tx,workspaceId,actor);
    const bs = await tx.select().from(brands).where(eq(brands.workspaceId,workspaceId));
    const brandIds = bs.map(b=>b.id);
    const ps = brandIds.length ? await tx.select().from(posts).where(inArray(posts.brandId,brandIds)) : [];
    const postIds = ps.map(p=>p.id);
    const media = await tx.select({id:mediaAssets.id,brandId:mediaAssets.brandId,mime:mediaAssets.mime,bytes:mediaAssets.bytes,width:mediaAssets.width,height:mediaAssets.height,sha256:mediaAssets.sha256,createdAt:mediaAssets.createdAt,data:mediaAssets.data}).from(mediaAssets).where(eq(mediaAssets.workspaceId,workspaceId));
    // Allowlisted channel and membership fields; no credentials, token, secret or internal metadata.
    const cs = brandIds.length ? await tx.select({id:channels.id,brandId:channels.brandId,provider:channels.provider,displayName:channels.displayName,url:channels.url,status:channels.status,createdAt:channels.createdAt}).from(channels).where(inArray(channels.brandId,brandIds)) : [];
    const members = await tx.select({userId:workspaceMembers.userId,role:workspaceMembers.role,joinedAt:workspaceMembers.joinedAt,name:users.name,email:users.email}).from(workspaceMembers).innerJoin(users,eq(users.id,workspaceMembers.userId)).where(eq(workspaceMembers.workspaceId,workspaceId));
    return {version:1,exportedAt:new Date().toISOString(),workspace:{id:ws.id,name:ws.name},brands:bs,channels:cs,
      posts:ps.map(p=>{const {approvalToken,...safe}=p; void approvalToken; return safe;}),
      targets:postIds.length?await tx.select().from(postTargets).where(inArray(postTargets.postId,postIds)):[],
      approvals:postIds.length?await tx.select({id:approvalDecisions.id,postId:approvalDecisions.postId,decision:approvalDecisions.decision,reviewerName:approvalDecisions.reviewerName,comment:approvalDecisions.comment,createdAt:approvalDecisions.createdAt}).from(approvalDecisions).where(inArray(approvalDecisions.postId,postIds)):[],
      events:postIds.length?await tx.select().from(postEvents).where(inArray(postEvents.postId,postIds)):[],
      media:media.map(({data,...asset})=>({...asset,dataBase64:data.toString('base64')})),members};
  });
}
/** Cancel without proration/invoicing. Expire open checkouts so deleted workspaces cannot purchase later. */
export async function cancelWorkspaceBilling(sub: {stripeSubscriptionId:string|null;stripeCustomerId:string|null}) {
  const client = stripe();
  if (sub.stripeCustomerId) {
    for await (const checkout of client.checkout.sessions.list({customer:sub.stripeCustomerId,status:'open',limit:100}))
      await client.checkout.sessions.expire(checkout.id);
    for await (const subscription of client.subscriptions.list({customer:sub.stripeCustomerId,status:'all',limit:100})) {
      if (!['canceled','incomplete_expired'].includes(subscription.status))
        await client.subscriptions.cancel(subscription.id,{invoice_now:false,prorate:false});
    }
  } else if (sub.stripeSubscriptionId) {
    try { await client.subscriptions.cancel(sub.stripeSubscriptionId,{invoice_now:false,prorate:false}); }
    catch(e) { if ((e as {code?:string}).code !== 'resource_missing') throw e; }
  }
}
export async function deleteWorkspace(workspaceId: string, actor: string, confirmation: string, cancel = cancelWorkspaceBilling) {
  const sub = await getDb().transaction(async tx => {
    await lockWorkspace(tx,workspaceId);
    const ws = await owner(tx,workspaceId,actor);
    if (confirmation !== ws.name) throw new ApiError(422,'confirmation_required','Type the exact workspace name to delete it.');
    const [billing] = await tx.select().from(billingState).where(eq(billingState.workspaceId,workspaceId));
    if (billing?.checkoutLeaseUntil && +billing.checkoutLeaseUntil > Date.now()) throw new ApiError(409,'billing_busy','Checkout is still opening. Retry deletion shortly.');
    await tx.execute(sql`insert into workspace_deletions (workspace_id) values (${workspaceId}::uuid) on conflict do nothing`);
    await tx.execute(sql`insert into offboarding_events (workspace_id, event) values (${workspaceId}::uuid,'workspace_deletion_started')`);
    const [sub] = await tx.select().from(subscriptions).where(eq(subscriptions.workspaceId,workspaceId));
    return sub;
  });
  // Deletion is retryable after a Stripe failure; the durable fence disables publishing/billing.
  if (sub && (sub.stripeSubscriptionId || sub.stripeCustomerId)) await cancel(sub);
  await getDb().transaction(async tx => {
    await lockWorkspace(tx,workspaceId);
    await owner(tx,workspaceId,actor);
    await tx.delete(workspaces).where(eq(workspaces.id,workspaceId));
    await tx.execute(sql`insert into offboarding_events (workspace_id, event) values (${workspaceId}::uuid,'workspace_deleted')`);
    await tx.execute(sql`update workspace_deletions set completed_at=now() where workspace_id=${workspaceId}::uuid`);
  });
}
export async function deleteAccount(actor: string, confirmation: string) {
  if (confirmation !== 'DELETE') throw new ApiError(422,'confirmation_required','Type DELETE to delete your account.');
  return getDb().transaction(async tx => {
    const [user] = await tx.select().from(users).where(eq(users.id,actor)).for('update');
    if (!user) throw new ApiError(401,'unauthorized','Sign in first.');
    // Lock all affected workspaces in stable order, identical to team mutations.
    const memberships = await tx.select().from(workspaceMembers).where(eq(workspaceMembers.userId,actor));
    const ids = memberships.map(m=>m.workspaceId);
    const owned = await tx.select().from(workspaces).where(eq(workspaces.ownerUserId,actor));
    const allIds = [...new Set([...ids,...owned.map(w=>w.id)])];
    if (allIds.length) {
      const ws = await tx.select().from(workspaces).where(inArray(workspaces.id,allIds)).orderBy(asc(workspaces.id)).for('update');
      for (const w of ws) {
        const members = await tx.select().from(workspaceMembers).where(eq(workspaceMembers.workspaceId,w.id));
        const otherOwner = members.find(m=>m.role==='owner' && m.userId!==actor);
        if (!otherOwner && (members.some(m=>m.userId===actor && m.role==='owner') || w.ownerUserId===actor))
          throw new ApiError(422,'last_owner','You are the last owner of a workspace. Delete the workspace or transfer ownership first.');
        if (w.ownerUserId === actor) await tx.update(workspaces).set({ownerUserId:otherOwner!.userId}).where(eq(workspaces.id,w.id));
      }
    }
    if (user.email) {
      for (const [table,column] of [['post_events','message'],['approval_decisions','reviewer_name'],['approval_decisions','comment'],['posts','approval_note'],['notifications','message']])
        await tx.execute(sql`update ${sql.identifier(table)} set ${sql.identifier(column)}=replace(${sql.identifier(column)},${user.email},'[deleted account]') where strpos(${sql.identifier(column)},${user.email})>0`);
      const escaped = JSON.stringify(user.email).slice(1,-1);
      await tx.execute(sql`update webhook_deliveries set payload=replace(payload::text,${escaped},'[deleted account]')::jsonb where strpos(payload::text,${escaped})>0`);
      await tx.delete(verificationTokens).where(eq(verificationTokens.identifier,user.email));
      await tx.delete(networkWaitlist).where(eq(networkWaitlist.email,user.email.toLowerCase()));
    }
    await tx.execute(sql`delete from request_rate_limits where key in (${'session:'+actor},${'billing:'+actor}) or key like ${'upload:%:'+actor}`);
    // Creator FKs for posts/media SET NULL; identity/session/account/key FKs cascade.
    await tx.delete(users).where(eq(users.id,actor));
    await tx.execute(sql`insert into offboarding_events (event) values ('account_deleted')`);
  });
}
