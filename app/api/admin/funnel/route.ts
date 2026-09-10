import { auth } from '@/auth';
import { funnelReport, isAdminEmail } from '@/lib/funnel';

export const runtime = 'nodejs';
export async function GET(request: Request) {
  const session = await auth();
  const email = session?.user?.email?.trim().toLowerCase();
  if (!isAdminEmail(email)) return new Response(null, { status: 404 });
  const days = Number(new URL(request.url).searchParams.get('days') ?? '30');
  return Response.json(await funnelReport(Number.isFinite(days) ? Math.min(365, Math.max(1, Math.floor(days))) : 30));
}
