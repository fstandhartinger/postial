import { sessionContext } from '@/lib/core';
import { exportWorkspace } from '@/lib/offboarding';
import { apiError } from '@/lib/api/errors';
import { sessionActionBudget } from '@/lib/rate-limit';
export async function GET() {
  try {
    const ctx = await sessionContext();
    if (!ctx) return Response.json({error:'Sign in first.'},{status:401});
    await sessionActionBudget(ctx.userId);
    const data = await exportWorkspace(ctx.workspace.id,ctx.userId);
    return Response.json(data,{headers:{'Content-Disposition':'attachment; filename="socialmint-export.json"','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
  } catch(e) { return apiError(e); }
}
