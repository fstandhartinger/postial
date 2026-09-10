import { readJson } from '@/lib/http/body';
import { ApiError, apiError } from '@/lib/api/errors';
import { createHmac } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { networkWaitlist } from '@/db/schema';
import { isIdentifiedClientIp, sharedRateLimit, trustedClientIp, UNIDENTIFIED_TRAFFIC_RATE_LIMIT, UNIDENTIFIED_TRAFFIC_RATE_WINDOW_SECONDS, WAITLIST_IDENTIFIED_RATE_LIMIT, WAITLIST_IDENTIFIED_RATE_WINDOW_SECONDS } from '@/lib/rate-limit';
import availability from '@/content/availability.json';

export const runtime = 'nodejs';
export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin && origin !== process.env.APP_URL) return Response.json({ error: 'Invalid origin' }, { status: 403 });
  if (!request.headers.get('content-type')?.startsWith('application/json')) return Response.json({ error: 'JSON required' }, { status: 422 });
  let body: { network?: unknown; email?: unknown; source?: unknown };
  try {
    body = await readJson(request,4096) as typeof body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
  } catch(e) { if(e instanceof ApiError) return apiError(e); return Response.json({ error: 'Invalid JSON' }, { status: 422 }); }
  const network = typeof body.network === 'string' ? body.network.trim().toLowerCase() : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const source = body.source ?? 'roadmap';
  if (!availability.networks.some(n => n.id === network && n.status !== 'live') || email.length > 254 || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i.test(email) || email.startsWith('.') || email.includes('..') || email.includes('.@') || !['pricing', 'roadmap'].includes(String(source))) {
    return Response.json({ error: 'Valid email, upcoming network and source required' }, { status: 422 });
  }
  const ip = trustedClientIp(request.headers);
  const secret = process.env.APP_ENCRYPTION_KEY || process.env.AUTH_SECRET;
  if (!secret) return Response.json({ error: 'Waitlist temporarily unavailable' }, { status: 503 });
  const ipHash = createHmac('sha256', secret).update(`waitlist:${ip}`).digest('hex');
  try {
    // Count every valid submission, including duplicates. A duplicate that
    // reaches the brake remains a generic success to avoid enumeration.
    const identified = isIdentifiedClientIp(ip);
    const attemptRetry = await sharedRateLimit(
      `waitlist:attempt:${ipHash}`,
      identified ? WAITLIST_IDENTIFIED_RATE_LIMIT : UNIDENTIFIED_TRAFFIC_RATE_LIMIT,
      identified ? WAITLIST_IDENTIFIED_RATE_WINDOW_SECONDS : UNIDENTIFIED_TRAFFIC_RATE_WINDOW_SECONDS,
    );
    if (attemptRetry) {
      const [duplicate] = await getDb().select({ id: networkWaitlist.id }).from(networkWaitlist).where(and(eq(networkWaitlist.network, network), eq(networkWaitlist.email, email))).limit(1);
      if (duplicate) return Response.json({ saved: true }, { status: 202, headers: { 'Cache-Control': 'no-store' } });
      return Response.json({ error: 'Hourly signup limit reached' }, { status: 429, headers: { 'Retry-After': String(attemptRetry), 'Cache-Control': 'no-store' } });
    }
    const status: number = await getDb().transaction(async tx => {
      // Shared across workers and restarts; serializes registrations for an IP.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${ipHash}, 0))`);
      const [existing] = await tx.select({ id: networkWaitlist.id }).from(networkWaitlist).where(and(eq(networkWaitlist.network, network), eq(networkWaitlist.email, email))).limit(1);
      if (existing) return 200;
      const inserted = await tx.insert(networkWaitlist).values({ network, email, ipHash, source: String(source) }).onConflictDoNothing().returning({ id: networkWaitlist.id });
      return inserted.length ? 201 : 200;
    });
    // Use one success status for new and duplicate submissions so the public
    // endpoint cannot enumerate registered email addresses.
    return Response.json(status === 429 ? { error: 'Hourly signup limit reached' } : { saved: true }, { status: status === 429 ? 429 : 202, headers: { 'Cache-Control': 'no-store', ...(status === 429 ? { 'Retry-After': '3600' } : {}) } });
  } catch { return Response.json({ error: 'Could not save signup. Please try again.' }, { status: 503 }); }
}
