// Shared Checkout/Portal budget per authenticated user, per server process.
// Multiple replicas require a shared store before scaling out.
const windows = new Map<string, { count: number; reset: number }>();
export function billingRateLimit(userId: string, now = Date.now()): number {
  for (const [key, window] of windows) if (window.reset <= now) windows.delete(key);
  const window = windows.get(userId) ?? { count: 0, reset: now + 60_000 };
  windows.set(userId, window);
  if (window.count >= 5) return Math.max(1, Math.ceil((window.reset - now) / 1000));
  window.count++;
  return 0;
}
