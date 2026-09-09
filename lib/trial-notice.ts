export function trialNotice(subscription:{status:string;trialEnd:string|null;currentPeriodEnd?:string|null}|null,now=Date.now()) {
  if(!subscription?.trialEnd || !['trialing','canceled','unpaid','incomplete_expired'].includes(subscription.status)) return null;
  const end=Date.parse(subscription.trialEnd);
  if(subscription.status !== 'trialing' && subscription.currentPeriodEnd && Date.parse(subscription.currentPeriodEnd)>end+1000) return null;
  if(!Number.isFinite(end) || end-now>3*86400000) return null;
  return end<=now?'expired':'ending';
}
