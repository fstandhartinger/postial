import { isPlan } from '@/lib/plans';
export function internalPath(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.startsWith('/') || /[\\\x00-\x20]/.test(value)) return;
  try {
    const decoded = decodeURIComponent(value);
    if (decoded.includes('//') || /[\\\x00-\x20]/.test(decoded)) return;
    if (new URL(value, 'https://postial.invalid').origin !== 'https://postial.invalid') return;
    return value;
  } catch { return; }
}
export function loginTarget(next: unknown, plan: unknown) {
  const path = internalPath(next) ?? '/app';
  return isPlan(plan) ? `/app/continue?${new URLSearchParams({ next: path, plan })}` : path;
}
