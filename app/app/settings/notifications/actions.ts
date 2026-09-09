"use server";
import { revalidatePath } from 'next/cache';
import { and,eq,isNull,inArray } from 'drizzle-orm';
import { coreContext,isUuid } from '@/lib/core';
import { webhookEndpoints,webhookDeliveries } from '@/db/schema';
import { createAlertDestination, testAlert, markNotificationRead, requireNotificationOwner } from '@/lib/notifications';
import { ApiError } from '@/lib/api/errors';
export async function notificationAction(_state:{message:string},form:FormData) {
  const {db,workspace,userId}=await coreContext();
  try {
    const action=String(form.get('action')),id=String(form.get('id')??'');
    if(action==='create') await createAlertDestination(workspace.id,userId,String(form.get('kind')),String(form.get('url')??'').trim(),form.getAll('event').map(String));
    else {
      if(!isUuid(id)) throw new ApiError(422,'validation_error','Invalid destination.');
      if(action==='read') await markNotificationRead(workspace.id,userId,id);
      else if(action==='test') await testAlert(workspace.id,userId,id);
      else if(action==='delete') {
        await requireNotificationOwner(workspace.id,userId);
        await db.transaction(async tx=>{
          const [e]=await tx.select().from(webhookEndpoints).where(and(eq(webhookEndpoints.id,id),eq(webhookEndpoints.workspaceId,workspace.id),isNull(webhookEndpoints.deletedAt))).for('update');
          if(!e||e.kind==='api') throw new ApiError(404,'not_found','Alert destination not found.');
          await tx.update(webhookEndpoints).set({active:false,deletedAt:new Date(),secretEnc:'',secretHash:''}).where(eq(webhookEndpoints.id,id));
          await tx.update(webhookDeliveries).set({status:'canceled',nextAttemptAt:null}).where(and(eq(webhookDeliveries.endpointId,id),inArray(webhookDeliveries.status,["pending","paused"])));
        });
      } else throw new ApiError(422,'validation_error','Unknown action.');
    }
    revalidatePath('/app','layout');
    return {message:action==='test'?'Test queued. Delivery status appears below after the next worker tick.':'Saved.'};
  } catch(e) {return {message:e instanceof ApiError?e.message:'Unable to save. Please try again.'};}
}
