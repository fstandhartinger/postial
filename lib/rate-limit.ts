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

// API budgets are atomic and shared across replicas, unlike the billing budget.
export async function apiRateLimit(keyId: string): Promise<number> {
  const [{getDb}, {apiRateLimits}, {sql}] = await Promise.all([import('@/db'), import('@/db/schema'), import('drizzle-orm')]);
  const [row] = await getDb().insert(apiRateLimits).values({keyId, expiresAt: new Date(Date.now() + 60000)})
    .onConflictDoUpdate({target: apiRateLimits.keyId, set: {
      attempts: sql`case when ${apiRateLimits.expiresAt} <= now() then 1 else least(${apiRateLimits.attempts} + 1, 61) end`,
      expiresAt: sql`case when ${apiRateLimits.expiresAt} <= now() then now() + interval '1 minute' else ${apiRateLimits.expiresAt} end`,
    }}).returning();
  return row.attempts > 60 ? Math.max(1, Math.ceil((row.expiresAt.getTime() - Date.now()) / 1000)) : 0;
}
