import type Stripe from 'stripe';
export function checkoutTrial(trial: boolean, metadata: Record<string, string>): Pick<Stripe.Checkout.SessionCreateParams, 'subscription_data' | 'payment_method_collection'> {
  return {
    subscription_data: { metadata, description: 'Postial social publishing subscription', ...(trial ? { trial_period_days: 14, trial_settings: { end_behavior: { missing_payment_method: 'cancel' as const } } } : {}) },
    payment_method_collection: trial ? 'if_required' : 'always',
  };
}
