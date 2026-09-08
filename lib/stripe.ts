import Stripe from 'stripe';
let client: Stripe | undefined;
export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}
export function stripe(): Stripe {
  return client ??= new Stripe(requiredEnv('STRIPE_SECRET_KEY'), { maxNetworkRetries: 2 });
}
export function appUrl(): string {
  return new URL(process.env.NEXT_PUBLIC_APP_URL ?? requiredEnv('AUTH_URL')).origin;
}
