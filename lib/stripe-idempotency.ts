/** Keep immediate repeated clicks on one Stripe Portal session. */
export function portalSessionIdempotencyKey(workspaceId: string, stripeCustomerId: string, now = Date.now()): string {
  return `socialmint-portal-${workspaceId}-${stripeCustomerId}-${Math.floor(now / 10000)}`;
}
