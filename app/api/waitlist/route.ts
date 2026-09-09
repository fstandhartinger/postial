import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';
import { and, eq, gte, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { networkWaitlist } from '@/db/schema';
import availability from '@/content/availability.json';

export const runtime = 'nodejs';
export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin && origin !== process.env.APP_URL) return Response.json({ error: 'Invalid origin' }, { status: 403 });
  if (!request.headers.get('content-type')?.startsWith('application/json')) return Response.json({ error: 'JSON required' }, { status: 422 });
  let body: { network?: unknown; email?: unknown; source?: unknown };
  try {
    const reader = request.body?.getReader();
    if (!reader) throw new Error();
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.length;
      if (size > 4096) { await reader.cancel(); return Response.json({ error: 'Request too large' }, { status: 413 }); }
      chunks.push(value);
    }
    body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
  } catch { return Response.json({ error: 'Invalid JSON' }, { status: 422 }); }
  const network = typeof body.network === 'string' ? body.network.trim().toLowerCase() : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const source = body.source ?? 'roadmap';
  if (!availability.networks.some(n => n.id === network && n.status !== 'live') || email.length > 254 || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i.test(email) || email.startsWith('.') || email.includes('..') || email.includes('.@') || !['pricing', 'roadmap'].includes(String(source))) {
    return Response.json({ error: 'Valid email, upcoming network and source required' }, { status: 422 });
  }
  // Trust only the rightmost hop appended by the ingress. Do not expose the
  // app port publicly; ingress must append/overwrite X-Forwarded-For.
  const forwarded = request.headers.get('x-forwarded-for')?.split(',').at(-1)?.trim() ?? '';
  const ip = isIP(forwarded) ? forwarded : 'unknown';
  const secret = process.env.APP_ENCRYPTION_KEY || process.env.AUTH_SECRET;
  if (!secret) return Response.json({ error: 'Waitlist temporarily unavailable' }, { status: 503 });
  const ipHash = createHmac('sha256', secret).update(`waitlist:${ip}`).digest('hex');
  try {
    const status = await getDb().transaction(async tx => {
      // Shared across workers and restarts; serializes registrations for an IP.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${ipHash}, 0))`);
      const [existing] = await tx.select({ id: networkWaitlist.id }).from(networkWaitlist).where(and(eq(networkWaitlist.network, network), eq(networkWaitlist.email, email))).limit(1);
      if (existing) return 200;
      const [count] = await tx.select({ total: sql<number>`count(*)::int` }).from(networkWaitlist).where(and(eq(networkWaitlist.ipHash, ipHash), gte(networkWaitlist.createdAt, new Date(Date.now() - 3600000))));
      if (count.total >= 10) return 429;
      const inserted = await tx.insert(networkWaitlist).values({ network, email, ipHash, source: String(source) }).onConflictDoNothing().returning({ id: networkWaitlist.id });
      return inserted.length ? 201 : 200;
    });
    return Response.json(status === 429 ? { error: 'Hourly signup limit reached' } : { saved: true }, { status, headers: { 'Cache-Control': 'no-store', ...(status === 429 ? { 'Retry-After': '3600' } : {}) } });
  } catch { return Response.json({ error: 'Could not save signup. Please try again.' }, { status: 503 }); }
}
