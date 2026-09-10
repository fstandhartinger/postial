import { gte, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { errorEvents } from '@/db/schema';

const MAX_PER_HOUR = 500;
const email = /\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g;
const bearer = /\bBearer\s+[A-Za-z0-9._~+/=-]+\b/gi;
const longSecret = /\b(?:sm_live_|sk_live_|whsec_|gh[pousr]_)[A-Za-z0-9_-]+\b/g;
const PERSISTED_MESSAGE = '[message omitted]';
const PERSISTED_MESSAGE_ALLOWLIST = new Set<string>(['Unable to complete this request.']);
const processHourlyCounts = new Map<number, number>();
const MAX_CAUSE_DEPTH = 3;

export function redactErrorValue(value: unknown): string {
  let text = typeof value === 'string' ? value : (() => { try { return JSON.stringify(value); } catch { return String(value); } })();
  text = text.replace(bearer, 'Bearer [REDACTED]').replace(longSecret, '[REDACTED]').replace(email, '[REDACTED_EMAIL]');
  text = text.replace(/\b(?:private\s+)?payload\b[^,}]*/gi, '[REDACTED_PAYLOAD]');
  text = text.replace(/(["']?(?:authorization|cookie|token|secret|password|credential|signature|api[-_]?key|access[-_]?token|refresh[-_]?token)["']?\s*[:=]\s*["']?)[^,"'}\s]+/gi, '$1[REDACTED]');
  return text.replace(/\b(?:body|content|text|message|caption|media|bytes|rawBody|requestBody)\b\s*[:=]\s*[^,}]+/gi, '$1=[REDACTED]').slice(0, 1000);
}

type StackFrame = { functionName: string; fileName: string; line: number };

function parseStackFrame(line: string): StackFrame | undefined {
  const match = line.match(/^\s*at\s+(?:(.*?)\s+\()?((?:file|https?):\/\/[^):]+|[^():]+):(\d+)(?::\d+)?\)?\s*$/);
  if (!match) return undefined;
  return { functionName: match[1]?.trim() || '<anonymous>', fileName: match[2], line: Number(match[3]) };
}

function stackFrames(error: unknown): StackFrame[] {
  if (!(error instanceof Error) || typeof error.stack !== 'string') return [];
  return error.stack.split('\n').slice(1).map(parseStackFrame).filter((frame): frame is StackFrame => Boolean(frame));
}

function normalizedPath(value: string): string {
  return value.replaceAll('\\', '/').replace(/\/+/g, '/').replace(/\/$/, '');
}

function projectRelativePath(fileName: string, projectRoot: string): string | undefined {
  const file = normalizedPath(fileName);
  const root = normalizedPath(projectRoot);
  if (!file.startsWith('/') || !root || (file !== root && !file.startsWith(`${root}/`))) return undefined;
  const result = file.slice(root.length).replace(/^\//, '');
  return result || undefined;
}

function isOwnFrame(frame: StackFrame, projectRoot: string): boolean {
  if (frame.fileName.startsWith('node:') || frame.fileName.includes('://')) return false;
  const projectRelative = projectRelativePath(frame.fileName, projectRoot);
  if (!projectRelative) return false;
  return !projectRelative.includes('/node_modules/') && !projectRelative.startsWith('node_modules/') && !projectRelative.includes('/.next/') && !projectRelative.startsWith('.next/');
}

function formatOwnFrame(frame: StackFrame, projectRoot: string): string {
  const file = projectRelativePath(frame.fileName, projectRoot) ?? 'unknown';
  return `${file}:${frame.line} (${frame.functionName.slice(0, 160)})`;
}

function formatFallbackFrame(frame: StackFrame | undefined): string {
  if (!frame) return 'fallback:unknown';
  return `fallback:${frame.functionName.slice(0, 160)}:${frame.line}`;
}

export function extractSourceLocation(error: unknown): string {
  const projectRoot = normalizedPath(String((globalThis as { process?: { cwd?: () => string } }).process?.cwd?.() ?? ''));
  const chain: unknown[] = [];
  let fallback: StackFrame | undefined;
  let current: unknown = error;
  const seen = new Set<unknown>();
  for (let depth = 0; depth < MAX_CAUSE_DEPTH && current && !seen.has(current); depth++) {
    seen.add(current);
    chain.push(current);
    const frames = stackFrames(current);
    fallback ??= frames[0];
    current = current instanceof Error ? (errorWithCause(current).cause) : undefined;
  }
  const deepestFrames = stackFrames(chain.at(-1));
  const own = deepestFrames.find(frame => isOwnFrame(frame, projectRoot));
  if (own) return formatOwnFrame(own, projectRoot);
  return formatFallbackFrame(fallback);
}

function errorWithCause(error: Error): Error & { cause?: unknown } {
  return error as Error & { cause?: unknown };
}

function errorDetails(error: unknown) {
  const errorClass = error instanceof Error ? error.constructor.name : 'UnknownError';
  const logMessage = redactErrorValue(error instanceof Error ? error.message : error);
  const sourceLocation = extractSourceLocation(error);
  let hash = 2166136261;
  for (const char of `${errorClass}:${logMessage}:${sourceLocation}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return { errorClass: errorClass.slice(0, 120), logMessage, message: PERSISTED_MESSAGE_ALLOWLIST.has(logMessage) ? logMessage : PERSISTED_MESSAGE, sourceLocation, fingerprint: (hash >>> 0).toString(16).padStart(8, '0') };
}

export type ErrorEventOptions = { route: string; status?: number; authenticated?: boolean; action?: string; now?: Date; requestId?: string };
export async function recordError(error: unknown, options: ErrorEventOptions): Promise<void> {
  try {
    const now = options.now ?? new Date();
    const hourKey = Math.floor(now.getTime() / 3600000);
    const details = errorDetails(error);
    const route = (options.action ? `action:${options.action}` : options.route).slice(0, 512);
    const id = options.requestId ?? errorRequestId();
    try { console.error(JSON.stringify({ event: 'error', timestamp: now.toISOString(), route, status: options.status ?? null, errorClass: details.errorClass, message: details.logMessage, fingerprint: details.fingerprint, authenticated: Boolean(options.authenticated), requestId: id })); } catch { /* Logging must not affect the operation. */ }
    const cap = Number(process.env.ERROR_VISIBILITY_TEST_CAP ?? MAX_PER_HOUR);
    const count = processHourlyCounts.get(hourKey) ?? 0;
    if (count >= cap) return;
    processHourlyCounts.set(hourKey, count + 1);
    await getDb().insert(errorEvents).values({ occurredAt: now, route, status: options.status, errorClass: details.errorClass, message: details.message, fingerprint: details.fingerprint, sourceLocation: details.sourceLocation, authenticated: Boolean(options.authenticated) });
  } catch { /* Error visibility is strictly best effort and must never affect the operation. */ }
}

export async function recentErrorCount(now = new Date()): Promise<number> {
  try { const [row] = await getDb().select({ count: sql<number>`count(*)::int` }).from(errorEvents).where(gte(errorEvents.occurredAt, new Date(now.getTime() - 3600000))); return Number(row?.count ?? 0); } catch { return 0; }
}

export async function retainErrors(now = new Date()): Promise<void> {
  try { await getDb().delete(errorEvents).where(sql`${errorEvents.occurredAt} < ${new Date(now.getTime() - 14 * 86400000)}`); } catch { /* maintenance is retryable */ }
}

export function errorRequestId() { return globalThis.crypto.randomUUID(); }
