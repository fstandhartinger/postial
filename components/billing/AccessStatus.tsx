import availability from '@/content/availability.json';
export const trialTerms = "The 14-day trial starts in Checkout without a card. Without a payment method, your subscription ends automatically at trial end and you are not charged. If you add a payment method in the customer portal during the trial, billing starts at the displayed price when the trial ends. You can cancel anytime.";
export function AccessStatus() {
  return <aside data-availability className="my-6 rounded-xl border border-emerald-200 bg-emerald-50 p-5"><strong>Early access</strong><p>Available today: {availability.available.join('; ')}.</p><p>Channels today: {availability.channels.join(', ')}.</p><p>Connect available (Early access): X, Threads, LinkedIn, Facebook and Instagram. Publishing is subject to each provider’s access conditions.</p><p>{availability.pending}.</p><p>{availability.signIn}.</p></aside>;
}
