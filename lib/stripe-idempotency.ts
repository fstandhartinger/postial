/** Keep repeated clicks in the same minute on one Stripe Portal session. */
export function portalSessionIdempotencyKey(workspaceId: string, now = Date.now()): string {
  return `socialmint-portal-${workspaceId}-${Math.floor(now / 60000)}`;
}
