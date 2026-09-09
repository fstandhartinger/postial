import Link from 'next/link';
import { CheckoutButton } from '@/components/billing/CheckoutButton';
import { items, words } from './copy';
export function Plans({ checkout = false }: { checkout?: boolean }) {
  return <><div className="marketing-grid two plans">{(['starter', 'agency'] as const).map(plan => {
    const section = plan === 'starter' ? 'Starter card' : 'Agency card';
    return <article className="panel plan" key={plan}><h3>{words(section, 'Plan name')}</h3><p>{words(section, 'Audience')}</p><p className="price"><strong>{words(section, 'Price')}</strong><span> / month · incl. VAT</span></p><ul className="feature-list">{items(section).filter(item => item.label === 'Feature').map(item => <li key={item.text}><span aria-hidden="true">✓</span>{item.text}</li>)}</ul><p className="note plan-note">{words(section, plan === 'starter' ? 'Boundary note' : 'Reviewer note')}</p><div className="plan-action">{checkout ? <CheckoutButton plan={plan}>Start free trial</CheckoutButton> : <Link className="primary" href={`/login?plan=${plan}`}>Start free — no card needed</Link>}</div></article>;
  })}</div><div className="pricing-notes"><p>{words('Shared pricing notes', 'Trial note')}</p><p>{words('Shared pricing notes', 'Cancellation note')}</p><p>Prices include applicable VAT.</p></div></>;
}
