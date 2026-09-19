import { auth } from '@/auth';
import { isAdminEmail } from '@/lib/funnel';
import { createVisitHandler, visitReport } from '@/lib/visit-report';

export const runtime = 'nodejs';
export const GET = createVisitHandler({ auth, isAdminEmail, report: visitReport });
export const HEAD = GET;
export const POST = GET;
export const PUT = GET;
export const PATCH = GET;
export const DELETE = GET;
export const OPTIONS = GET;
