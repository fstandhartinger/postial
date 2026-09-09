import { sessionActionBudget } from '@/lib/rate-limit';
import {createHash} from 'node:crypto';
import {eq,and} from 'drizzle-orm';
import source from '@/content/dpa.json';
import {getDb} from '@/db';
import {dpaAcceptances,workspaceMembers} from '@/db/schema';
import {ApiError} from '@/lib/api/errors';
export const dpaVersion='2026-09-09';
export const dpaHash=createHash('sha256').update(source).digest('hex');
export async function acceptDpa(workspaceId:string,userId:string){
  await sessionActionBudget(userId);
  return getDb().transaction(async tx=>{
    const [member]=await tx.select().from(workspaceMembers).where(and(eq(workspaceMembers.workspaceId,workspaceId),eq(workspaceMembers.userId,userId),eq(workspaceMembers.role,'owner'))).for('share');
    if(!member) throw new ApiError(403,'owner_required','Only a workspace owner can accept the DPA.');
    await tx.insert(dpaAcceptances).values({workspaceId,userId,version:dpaVersion,documentHash:dpaHash}).onConflictDoNothing();
  });
}
