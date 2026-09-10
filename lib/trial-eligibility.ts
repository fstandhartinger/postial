import type Stripe from 'stripe';

export type TrialEligibility = 'eligible' | 'ineligible' | 'unknown';

type TrialEligibilityInput = {
  trialUsedAt: Date | null;
  localStripeSubscriptionId?: string | null;
  stripeCustomerId?: string | null;
  workspaceId: string;
  client: Stripe;
};

/** Read-only mirror of the checkout route's three trial conditions. */
export async function trialEligibility(input: TrialEligibilityInput): Promise<TrialEligibility> {
  try {
    if (input.trialUsedAt || input.localStripeSubscriptionId) return 'ineligible';

    let customerId = input.stripeCustomerId;
    if (!customerId) {
      const customers = await input.client.customers.search({
        query: `metadata['workspace_id']:'${input.workspaceId}' AND metadata['app']:'socialmint'`,
        limit: 2,
      });
      if (customers.data.length > 1) return 'unknown';
      customerId = customers.data[0]?.id;
    }
    if (!customerId) return 'eligible';

    const existing = await input.client.subscriptions.list({ customer: customerId, status: 'all', limit: 100 });
    return !input.trialUsedAt && !existing.data.length && !input.localStripeSubscriptionId
      ? 'eligible'
      : 'ineligible';
  } catch {
    return 'unknown';
  }
}
