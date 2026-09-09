import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { getDb } from '../db';
async function main() {
  await getDb().transaction(async tx => {
    // Temporary tables shadow real tables only inside this transaction/connection.
    await tx.execute(sql`create temporary table posts (id uuid, brand_id uuid) on commit drop`);
    await tx.execute(sql`create temporary table webhook_endpoints (id uuid, active boolean) on commit drop`);
    await tx.execute(sql`create temporary table webhook_deliveries (id uuid, endpoint_id uuid, event text, payload jsonb, status text, next_attempt_at timestamptz) on commit drop`);
    const post = crypto.randomUUID(), brand = crypto.randomUUID(), endpoint = crypto.randomUUID();
    await tx.execute(sql`insert into posts values (${post}, ${brand})`);
    await tx.execute(sql`insert into webhook_endpoints values (${endpoint}, false)`);
    const payload = {id: crypto.randomUUID(), event: 'approval.decided', created_at: '2026-09-09T12:00:00Z', data: {post_id: post, decision: 'approved', reviewer_name: 'PRIVATE NAME', comment: 'PRIVATE COMMENT'}};
    await tx.execute(sql`insert into webhook_deliveries values (${crypto.randomUUID()}, ${endpoint}, 'approval.decided', ${JSON.stringify(payload)}::jsonb, 'pending', now())`);
    for (const statement of readFileSync('drizzle/0007_panoramic_plazm.sql', 'utf8').split('--> statement-breakpoint')) await tx.execute(sql.raw(statement));
    const [row] = await tx.execute(sql`select * from webhook_deliveries`);
    assert(!JSON.stringify(row.payload).includes('PRIVATE'));
    const data = (row.payload as {data: Record<string, unknown>}).data;
    assert.deepEqual(Object.keys(data).sort(), ['post_id', 'brand_id', 'decision', 'decided_at', 'has_comment', 'post_url'].sort());
    assert.equal(data.brand_id, brand); assert.equal(data.has_comment, true); assert.equal(row.status, 'paused');
  });
  console.log('PASS complete 0007 SQL on isolated temporary tables: retained technical metadata, historical name/comment removed, disabled pending deliveries paused');
}
main().then(() => process.exit(0)).catch(() => {console.error('Migration fixture verification failed'); process.exit(1);});
