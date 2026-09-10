import { gte, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { errorEventHourly, errorEvents } from '@/db/schema';

const MAX_PER_HOUR = 500;
const secretKey = /(authorization|cookie|token|secret|password|credential|signature|api[-_]?key|access[-_]?token|refresh[-_]?token)/i;
const email = /\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g;
const bearer = /\bBearer\s+[A-Za-z0-9._~+/=-]+\b/gi;
const longSecret = /\b(?:sm_live_|sk_live_|whsec_|gh[pousr]_)[A-Za-z0-9_-]+\b/g;

export function redactErrorValue(value: unknown): string {
  let text = typeof value === 'string' ? value : (() => { try { return JSON.stringify(value); } catch { return String(value); } })();
  text = text.replace(bearer, 'Bearer [REDACTED]').replace(longSecret, '[REDACTED]').replace(email, '[REDACTED_EMAIL]');
  text = text.replace(/\b(?:private\s+)?payload\b[^,}]*/gi, '[REDACTED_PAYLOAD]');
  text = text.replace(/(["']?(?:authorization|cookie|token|secret|password|credential|signature|api[-_]?key|access[-_]?token|refresh[-_]?token)["']?\s*[:=]\s*["']?)[^,"'}\s]+/gi, '$1[REDACTED]');
  return text.replace(/\b(?:body|content|text|message|caption|media|bytes|rawBody|requestBody)\b\s*[:=]\s*[^,}]+/gi, '$1=[REDACTED]').slice(0, 1000);
}

function errorDetails(error: unknown) {
  const errorClass = error instanceof Error ? error.constructor.name : 'UnknownError';
  const message = redactErrorValue(error instanceof Error ? error.message : error);
  let hash = 2166136261;
  for (const char of `${errorClass}:${message}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return { errorClass: redactErrorValue(errorClass).slice(0, 120), message, fingerprint: (hash >>> 0).toString(16).padStart(8, '0') };
}

export type ErrorEventOptions = { route: string; status?: number; authenticated?: boolean; action?: string; now?: Date; requestId?: string };
export async function recordError(error: unknown, options: ErrorEventOptions): Promise<void> {
  try {
    const now = options.now ?? new Date();
    const hour = new Date(Math.floor(now.getTime() / 3600000) * 3600000);
    const details = errorDetails(error);
    const route = (options.action ? `action:${options.action}` : options.route).slice(0, 512);
    const id = options.requestId ?? errorRequestId();
    try { console.error(JSON.stringify({ event: 'error', timestamp: now.toISOString(), route, status: options.status ?? null, errorClass: details.errorClass, message: details.message, fingerprint: details.fingerprint, authenticated: Boolean(options.authenticated), requestId: id })); } catch { /* Logging must not affect the operation. */ }
    const db = getDb();
    const [counter] = await db.insert(errorEventHourly).values({ hour, count: 1 }).onConflictDoUpdate({ target: errorEventHourly.hour, set: { count: sql`${errorEventHourly.count} + 1` } }).returning({ count: errorEventHourly.count });
    const cap = Number(process.env.ERROR_VISIBILITY_TEST_CAP ?? MAX_PER_HOUR);
    if (Number(counter?.count) > cap) return;
    await db.insert(errorEvents).values({ occurredAt: now, route, status: options.status, errorClass: details.errorClass, message: details.message, fingerprint: details.fingerprint, authenticated: Boolean(options.authenticated) });
  } catch { /* Error visibility is strictly best effort and must never affect the operation. */ }
}

export async function recentErrorCount(now = new Date()): Promise<number> {
  try { const [row] = await getDb().select({ count: sql<number>`count(*)::int` }).from(errorEvents).where(gte(errorEvents.occurredAt, new Date(now.getTime() - 3600000))); return Number(row?.count ?? 0); } catch { return 0; }
}

export async function retainErrors(now = new Date()): Promise<void> {
  try { await getDb().delete(errorEvents).where(sql`${errorEvents.occurredAt} < ${new Date(now.getTime() - 14 * 86400000)}`); await getDb().delete(errorEventHourly).where(sql`${errorEventHourly.hour} < ${new Date(now.getTime() - 14 * 86400000)}`); } catch { /* maintenance is retryable */ }
}

export function errorRequestId() { return globalThis.crypto.randomUUID(); }
