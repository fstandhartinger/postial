import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { getDb } from '../db';
import { users, brands, posts, maintenanceRuns } from '../db/schema';
import { mediaAssets } from '../db/media-schema';
import { ensureWorkspace } from '../lib/workspaces';
import { retainMedia } from '../lib/media/retention';
export async function verifyRetention() {
  const db=getDb(), userId=crypto.randomUUID();
  const [previous] = await db.select().from(maintenanceRuns).where(eq(maintenanceRuns.name,'media_retention'));
  try {
    await db.insert(users).values({id:userId});
    const ws=await ensureWorkspace(userId);
    const [brand]=await db.insert(brands).values({workspaceId:ws.id,name:'Retention fixture',slug:userId}).returning();
    const ids=Array.from({length:4},()=>randomBytes(32).toString('base64url'));
    await db.insert(mediaAssets).values(ids.map((id,i)=>({id,workspaceId:ws.id,uploaderUserId:userId,mime:'image/png',bytes:4,width:1,height:1,sha256:'fixture',data:Buffer.from('test'),createdAt:new Date(Date.now()-(i===2?1:31)*86400000)})));
    await db.insert(posts).values({brandId:brand.id,authorUserId:userId,body:'Reference fixture',mediaUrls:[`https://old.example/m/${ids[1]}`,`https://old.example/m/${ids[3]}?v=1`]});
    await db.insert(maintenanceRuns).values({name:'media_retention',completedAt:new Date(0)}).onConflictDoUpdate({target:maintenanceRuns.name,set:{completedAt:new Date(0)}});
    const result=await retainMedia(); assert(result.ran); assert(result.count>=1); assert(result.bytes>=4);
    const kept=await db.select({id:mediaAssets.id}).from(mediaAssets).where(eq(mediaAssets.workspaceId,ws.id));
    assert.deepEqual(kept.map(r=>r.id).sort(),ids.slice(1).sort());
    assert.equal((await retainMedia()).ran,false);
    console.log('Retention: old unused deleted, old referenced and fresh preserved, DB daily guard passed');
  } finally {
    await db.delete(users).where(eq(users.id,userId));
    if(previous) await db.update(maintenanceRuns).set({completedAt:previous.completedAt}).where(eq(maintenanceRuns.name,'media_retention'));
    else await db.delete(maintenanceRuns).where(eq(maintenanceRuns.name,'media_retention'));
  }
}
if (process.argv[1]?.endsWith('verify-retention.ts')) verifyRetention().then(()=>process.exit(0)).catch(()=>{console.error('Retention verification failed');process.exit(1);});
