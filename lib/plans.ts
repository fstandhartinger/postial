export const TRIAL_DAYS = 14;
export const PLANS = {
  starter: { name: "Starter", monthlyPriceEur: 19, get priceId() { return process.env.STRIPE_PRICE_STARTER; } },
  agency: { name: "Agency", monthlyPriceEur: 49, get priceId() { return process.env.STRIPE_PRICE_AGENCY; } },
} as const;

export const plans = {
  starter: { name: 'Starter', brands: 3, seats: 1, approvalLinks: false, monthlyEuro: 19, lookupKey: 'socialmint_starter_monthly', priceEnv: 'STRIPE_PRICE_STARTER' },
  agency: { name: 'Agency', brands: 15, seats: 5, approvalLinks: true, monthlyEuro: 49, lookupKey: 'socialmint_agency_monthly', priceEnv: 'STRIPE_PRICE_AGENCY' },
} as const;
export type Plan = keyof typeof plans;
export function isPlan(value: unknown): value is Plan { return value === 'starter' || value === 'agency'; }
