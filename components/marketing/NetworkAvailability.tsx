import availability from '@/content/availability.json';
import { configuredProviders } from '@/lib/auth-providers';
import { isOAuthProvider, oauthConfig } from '@/lib/publishers/oauth-config';
import { NetworkWaitlist } from './NetworkWaitlist';

export const networkSummary = 'Live: Bluesky, Mastodon, Telegram. X, Threads, LinkedIn and Facebook connections are Early access when configured; publishing is subject to provider conditions. Instagram is planned; platform review required, with no confirmed release date.';

export function NetworkAvailability({ source }: { source?: 'pricing' | 'roadmap' }) {
  return <div>{(['live', 'preparation', 'planned'] as const).map(status => <section className="my-6" key={status}><h3>{status === 'live' ? 'Live' : status === 'preparation' ? 'Early access connections' : 'Planned'}</h3><div className="marketing-grid three">{availability.networks.filter(network => network.status === status).map(network => {
    const configured = isOAuthProvider(network.id) && Boolean(oauthConfig(network.id));
    return <article className="panel p-5" key={network.id} data-network={network.id} data-status={status}><h4>{network.name}</h4><p>{status === 'live' ? 'Available today' : status === 'preparation' && !configured ? 'Connection not configured. Publishing remains subject to provider access and conditions; no confirmed release date.' : network.dependency}</p>{status !== 'live' && source && <NetworkWaitlist network={network.id} name={network.name} source={source} />}</article>;
  })}</div></section>)}</div>;
}

export function MarketingAccessStatus() {
  const { google, email } = configuredProviders();
  const signIn = google && email ? 'Google sign-in and magic links are available' : google ? 'Google sign-in is available' : email ? 'Magic links are available' : 'Sign-in is not configured — try the interactive demo meanwhile';
  return <aside data-availability className="my-6 rounded-xl border border-emerald-200 bg-emerald-50 p-5"><strong>Early access</strong><p>{networkSummary}</p><p>Available today: {availability.available.join('; ')}.</p><p>{availability.pending}.</p><p>{signIn}.</p></aside>;
}
