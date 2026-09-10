import Link from 'next/link';
import { CheckoutButton } from '@/components/billing/CheckoutButton';
import availability from '@/content/availability.json';
import { words } from './copy';
import { SignInNotice } from './SignInNotice';
import { TRIAL_DAYS, plans, type Plan } from '@/lib/plans';

export function marketingPlanLimits(plan: Plan) {
  const value = plans[plan];
  const storage = value.mediaBytes >= 1024 * 1024 * 1024
    ? `${value.mediaBytes / (1024 * 1024 * 1024)} GiB storage`
    : `${value.mediaBytes / (1024 * 1024)} MiB storage`;
  return [`${value.brands} brands`, `${value.seats} ${value.seats === 1 ? 'user' : 'users'}`, storage];
}
export function marketingPlanPrice(plan: Plan) { return `€${plans[plan].monthlyEuro}`; }
export function Plans({ checkout = false }: { checkout?: boolean }) {
  return <><div className="marketing-grid two plans">{(['starter', 'agency'] as const).map(plan => {
    const section = plan === 'starter' ? 'Starter card' : 'Agency card';
    const limits = marketingPlanLimits(plan);
    const features = availability[plan].filter(text => !/^\d+ (brands|users?)$/.test(text));
    return <article className="panel plan" key={plan}><h3>{words(section, 'Plan name')}</h3><p>{words(section, 'Audience')}</p><p className="price"><strong>{marketingPlanPrice(plan)}</strong><span> / month · incl. VAT</span></p><ul className="feature-list">{[...limits, ...features].map(text => <li key={text}><span aria-hidden="true">✓</span>{text}</li>)}</ul>{plan === "agency" && <p>{availability.pending}</p>}<p className="note plan-note">{words(section, plan === 'starter' ? 'Boundary note' : 'Reviewer note')}</p><div className="plan-action">{checkout ? <CheckoutButton plan={plan}>Start free trial</CheckoutButton> : <Link prefetch={false} className="primary" href={`/login?plan=${plan}`}>Start free — no card needed</Link>}<SignInNotice /></div></article>;
  })}</div><div className="pricing-notes"><p>{words('Shared pricing notes', 'Trial note')}</p><p>{words('Shared pricing notes', 'Cancellation note')}</p><p>{TRIAL_DAYS}-day trial: if you do not add a payment method, Stripe cancels the subscription at trial end and no charge is made. Add a payment method in the customer portal to continue on the displayed monthly plan.</p><p>Prices include applicable VAT.</p></div></>;
}
