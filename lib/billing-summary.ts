import {stripe} from '@/lib/stripe';
import type {subscriptions} from '@/db/schema';
export async function nextCharge(subscription:typeof subscriptions.$inferSelect|null) {
  if(!subscription?.stripeSubscriptionId || !subscription.stripeCustomerId || ['canceled','unpaid','incomplete_expired'].includes(subscription.status) || subscription.cancelAtPeriodEnd) return 'No charge scheduled';
  try {
    const client=stripe();
    const [sub,customer]=await Promise.all([client.subscriptions.retrieve(subscription.stripeSubscriptionId),client.customers.retrieve(subscription.stripeCustomerId)]);
    if(customer.deleted) return 'No charge scheduled';
    const method=sub.default_payment_method || sub.default_source || customer.invoice_settings.default_payment_method || customer.default_source;
    if(!method) return 'No charge scheduled';
    const invoice=await client.invoices.createPreview({customer:subscription.stripeCustomerId,subscription:subscription.stripeSubscriptionId});
    const amount=new Intl.NumberFormat('en-US',{style:'currency',currency:invoice.currency}).format(invoice.amount_due/100);
    const date=invoice.next_payment_attempt ?? invoice.period_end;
    return `Next charge: ${amount}${date ? ` · ${new Date(date*1000).toLocaleDateString('en-US',{timeZone:'UTC',dateStyle:'medium'})} (UTC)` : ''}. Estimate from Stripe; changes may affect the final amount.`;
  } catch {return 'Next charge temporarily unavailable. Open billing to check the current amount.';}
}
