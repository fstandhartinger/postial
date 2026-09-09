import type { NextRequest } from 'next/server';
import { handlers } from '@/auth';
import { readBody } from '@/lib/http/body';
import { apiError } from '@/lib/api/errors';
export const GET = handlers.GET;
export async function POST(request: NextRequest) {
  try { await readBody(request.clone()); return await handlers.POST(request); }
  catch(e) { return apiError(e); }
}
export const runtime = 'nodejs';
