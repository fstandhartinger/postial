import { randomUUID, randomBytes } from 'node:crypto';
import { and, eq, isNull, or, desc } from 'drizzle-orm';
import { getDb } from '@/db';
import { notifications, webhookEndpoints, webhookDeliveries, workspaceMembers, workspaces } from '@/db/schema';
import { encryptCredentials } from '@/lib/crypto';
import { appUrl } from '@/lib/stripe';
import { validateWebhookUrl } from '@/lib/api/webhooks';
import { hash } from '@/lib/api/auth';
import { ApiError } from '@/lib/api/errors';
import type { Tx } from '@/lib/api/post-service';
export const alertEvents = ['failed','needs_review','held','approval.decided','token_expired'] as const;
export type AlertEvent = typeof alertEvents[number];
const messages: Record<AlertEvent,string> = {failed:'Publishing failed. Review the post and retry.',needs_review:'Publishing result is uncertain. Check the channel before retrying.',held:'Scheduled posts paused — subscription inactive or brand exceeds plan limit.', 'approval.decided':'A client has submitted an approval decision.',token_expired:'Channel access expired. Reconnect the channel.'};
export async function notifyWorkspace(tx:Tx,workspaceId:string,type:AlertEvent,postId:string|null=null) {
  const message=messages[type];
  await tx.insert(notifications).values({workspaceId,type,postId,message});
  const endpoints=await tx.select().from(webhookEndpoints).where(and(eq(webhookEndpoints.workspaceId,workspaceId),eq(webhookEndpoints.active,true),isNull(webhookEndpoints.deletedAt))).for('share');
  for(const endpoint of endpoints.filter(e=>e.kind!=='api' && e.events.includes(type))) {
    const text=`SocialMint: ${message} ${appUrl()}${postId?`/app/posts/${postId}`:'/app/channels'}`;
    await tx.insert(webhookDeliveries).values({endpointId:endpoint.id,event:`alert.${type}`,payload:{id:randomUUID(),...(endpoint.kind==='discord'?{content:text}:{text})}});
  }
}
export async function unreadNotifications(workspaceId:string,userId:string) {
  return getDb().select().from(notifications).where(and(eq(notifications.workspaceId,workspaceId),or(isNull(notifications.userId),eq(notifications.userId,userId)),isNull(notifications.readAt))).orderBy(desc(notifications.createdAt)).limit(50);
}
export async function markNotificationRead(workspaceId:string,userId:string,id:string) {
  // Shared notices are acknowledged for the workspace, personal ones by their recipient.
  await getDb().update(notifications).set({readAt:new Date()}).where(and(eq(notifications.id,id),eq(notifications.workspaceId,workspaceId),or(isNull(notifications.userId),eq(notifications.userId,userId))));
}
export async function requireNotificationOwner(workspaceId:string,userId:string) {
  const [member]=await getDb().select().from(workspaceMembers).where(and(eq(workspaceMembers.workspaceId,workspaceId),eq(workspaceMembers.userId,userId),eq(workspaceMembers.role,'owner')));
  if(!member) throw new ApiError(403,'owner_required','Only the workspace owner can manage alert destinations.');
}
export async function createAlertDestination(workspaceId:string,userId:string,kind:string,url:string,events:string[]) {
  await requireNotificationOwner(workspaceId,userId);
  if(!['slack','discord','mattermost'].includes(kind)||!events.length||events.some(e=>!alertEvents.includes(e as AlertEvent))) throw new ApiError(422,'validation_error','Select a destination type and events.');
  await validateWebhookUrl(url);
  const secret=randomBytes(32).toString('base64url');
  return getDb().transaction(async tx=>{
    await tx.select().from(workspaces).where(eq(workspaces.id,workspaceId)).for('update');
    const endpoints=await tx.select().from(webhookEndpoints).where(and(eq(webhookEndpoints.workspaceId,workspaceId),isNull(webhookEndpoints.deletedAt)));
    if(endpoints.filter(e=>e.kind!=='api').length>=10) throw new ApiError(422,'validation_error','Maximum 10 alert destinations.');
    const [row]=await tx.insert(webhookEndpoints).values({workspaceId,kind,url:'',events:[...new Set(events)],secretHash:hash(secret),secretEnc:encryptCredentials({secret,url})}).returning({id:webhookEndpoints.id});
    return row;
  });
}
export async function testAlert(workspaceId:string,userId:string,id:string) {
  await requireNotificationOwner(workspaceId,userId);
  return getDb().transaction(async tx=>{
    const [endpoint]=await tx.select().from(webhookEndpoints).where(and(eq(webhookEndpoints.workspaceId,workspaceId),eq(webhookEndpoints.id,id),eq(webhookEndpoints.active,true),isNull(webhookEndpoints.deletedAt))).for('share');
    if(!endpoint||endpoint.kind==='api') throw new ApiError(404,'not_found','Alert destination not found.');
    // Bound repeated tests using the durable outbox under a workspace lock.
    await tx.select().from(workspaces).where(eq(workspaces.id,workspaceId)).for('update');
    const [last]=await tx.select().from(webhookDeliveries).where(and(eq(webhookDeliveries.endpointId,id),eq(webhookDeliveries.event,'alert.test'))).orderBy(desc(webhookDeliveries.createdAt)).limit(1);
    if(last && Date.now()-last.createdAt.getTime()<60000) throw new ApiError(429,'rate_limited','Wait a minute before testing again.');
    await tx.insert(webhookDeliveries).values({endpointId:id,event:'alert.test',payload:{id:randomUUID(),...(endpoint.kind==='discord'?{content:'SocialMint test alert: your destination is connected.'}:{text:'SocialMint test alert: your destination is connected.'})}});
  });
}
