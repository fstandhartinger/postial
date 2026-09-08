export const TRIAL_DAYS = 14;
export const PLANS = {
  starter: { name: "Starter", monthlyPriceEur: 19, get priceId() { return process.env.STRIPE_PRICE_STARTER; } },
  agency: { name: "Agency", monthlyPriceEur: 49, get priceId() { return process.env.STRIPE_PRICE_AGENCY; } },
} as const;
