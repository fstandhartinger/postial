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
  return Object.keys(registry) as Provider[];
}
