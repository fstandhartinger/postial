import { eq, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { maintenanceRuns, workspaces } from '@/db/schema';
let lastRun = 0;
/** Database guard and deletion commit together; failures remain retryable. */
export async function retainMedia(now = new Date()) {
  return getDb().transaction(async tx => {
    await tx.insert(maintenanceRuns).values({name:'media_retention', completedAt:new Date(0)}).onConflictDoNothing();
    const [guard] = await tx.select().from(maintenanceRuns).where(eq(maintenanceRuns.name,'media_retention')).for('update');
    if (+guard.completedAt > +now - 86400000) return {ran:false, count:0, bytes:0};
    // Same lock order as all post/media writes. References are checked across origins and workspaces.
    const owners = await tx.execute(sql`select distinct workspace_id as id from media_assets where created_at < ${new Date(+now-30*86400000).toISOString()}::timestamptz order by workspace_id`);
    let count=0, bytes=0;
    for (const owner of owners) {
      await tx.select({id:workspaces.id}).from(workspaces).where(eq(workspaces.id,String(owner.id))).for('update');
      const removed = await tx.execute(sql`delete from media_assets a where a.workspace_id = ${String(owner.id)}::uuid and a.created_at < ${new Date(+now-30*86400000).toISOString()}::timestamptz and not exists (select 1 from posts p, jsonb_array_elements_text(p.media_urls) media(url) where media.url ~ ('/m/' || a.id || '([?#].*)?$')) returning bytes`);
      count += removed.length;
      bytes += removed.reduce((sum,r) => sum + Number(r.bytes),0);
    }
    const ago = (days:number) => new Date(+now-days*86400000).toISOString();
    await tx.execute(sql`delete from webhook_deliveries where created_at < ${ago(30)}::timestamptz`);
    await tx.execute(sql`delete from notifications where created_at < ${ago(90)}::timestamptz`);
    for (const table of ['request_rate_limits','approval_rate_limits','api_rate_limits'])
      await tx.execute(sql`delete from ${sql.identifier(table)} where expires_at < ${ago(1)}::timestamptz`);
    await tx.execute(sql`delete from workspace_invites where accepted_at < ${ago(30)}::timestamptz or revoked_at < ${ago(30)}::timestamptz or expires_at < ${ago(30)}::timestamptz`);
    await tx.execute(sql`delete from oauth_states where expires_at < ${ago(1)}::timestamptz`);
    await tx.execute(sql`delete from offboarding_events where created_at < ${ago(90)}::timestamptz`);
    let funnelCount = 0;
    while (true) {
      const removed = await tx.execute(sql`delete from funnel_events where id in (select id from funnel_events where day < ${new Date(+now-180*86400000).toISOString().slice(0, 10)}::date order by day, id limit 1000) returning id`);
      funnelCount += removed.length;
      if (removed.length < 1000) break;
    }
    await tx.update(maintenanceRuns).set({completedAt:now}).where(eq(maintenanceRuns.name,'media_retention'));
    console.info('Media retention complete', {count,bytes,funnelCount});
    return {ran:true,count,bytes,funnelCount};
  });
}
export async function mediaRetentionTick() {
  if (Date.now()-lastRun < 86400000) return;
  await retainMedia();
  lastRun = Date.now();
}
