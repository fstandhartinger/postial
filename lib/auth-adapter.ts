import type { Adapter, AdapterAccount } from 'next-auth/adapters';
/** Google is used for identity only; provider bearer tokens are never persisted. */
export function identityOnlyAdapter(adapter: Adapter): Adapter {
  return {...adapter, linkAccount: (account: AdapterAccount) => {
    const safe = {...account};
    delete safe.access_token; delete safe.refresh_token; delete safe.id_token;
    return adapter.linkAccount!(safe);
  }};
}
