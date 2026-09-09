import { endpoint } from '@/lib/api/auth';
import { json } from '@/lib/api/errors';
import { plans } from '@/lib/plans';
export const runtime = 'nodejs';
export const GET = endpoint(undefined, async (_request, ctx) => json({workspace: {id: ctx.workspace.id, name: ctx.workspace.name, slug: ctx.workspace.slug}, plan: 'agency', limits: {brands: plans.agency.brands, seats: plans.agency.seats, requests_per_minute: 60}, scopes: ctx.key.scopes}));
