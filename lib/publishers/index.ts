import type { Provider, Publisher } from "./types";
export * from "./types";

/** Registry of implemented adapters. lib/publishers/<provider>.ts registers itself here. */
const registry: Partial<Record<Provider, Publisher>> = {};

export function registerPublisher(p: Publisher) {
  registry[p.provider] = p;
}

export function getPublisher(provider: Provider): Publisher {
  const p = registry[provider];
  if (!p) throw new Error(`No publisher implemented for provider "${provider}"`);
  return p;
}

export function availableProviders(): Provider[] {
  return (Object.keys(registry) as Provider[]).filter(p => !isOAuthProvider(p) || !!oauthConfig(p));
}

import { bluesky } from './bluesky';
import { mastodon } from './mastodon';
import { telegram } from './telegram';

registerPublisher(bluesky);
registerPublisher(mastodon);
registerPublisher(telegram);

import { x } from './x';
import { threads } from './threads';
import { linkedin } from './linkedin';
import { facebook } from './facebook';
import { instagram } from './instagram';
import { isOAuthProvider, oauthConfig } from './oauth-config';
registerPublisher(x);
registerPublisher(threads);
registerPublisher(linkedin);
registerPublisher(facebook);
registerPublisher(instagram);
