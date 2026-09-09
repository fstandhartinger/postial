# X/Threads verification — 2026-09-09

Integrated on top of main `585ef98` (includes the cycle-5 media migration).
OAuth migration regenerated after rebase as `0009_flippant_vance_astro`.

Executed successfully:

- `npm run db:generate`; `npm run db:migrate` on a newly recreated, isolated local PostgreSQL database.
- `npx tsx --test scripts/verify-publishers.ts`: 67 passing tests, no failures. Provider fetch and DNS are mocked; the existing TLS connector test uses a local server.
- `npx tsx scripts/verify-oauth.ts`: real local HTTP route wrappers, Auth.js sessions and database storage; loopback token/account endpoints replace X/Meta. Session/origin rejection, foreign user/brand rejection, provider binding, PKCE S256, encrypted storage, reconnect upsert, expiry, concurrent single-use consumption, disabled provider and production override rejection all passed.
- OAuth verifier also exercised the real worker: two targets on one X channel cause exactly one token rotation, persist refreshed credentials, and publish using the renewed token. Missing refresh capability causes `token_expired` and prevents publication.
- `npx tsx scripts/verify-core.ts`: encryption integrity, DST, concurrent claims, backoff, credential expiry, orphan recovery, approval holds, retry budget, entitlement downgrade/hold/resume and existing provider uncertain-outcome regression all passed.
- `npm run lint`, `npx tsc --noEmit`, `npm run build` including standalone preparation.
- `git diff --check`; changed-file secret scan against secret-like environment values and private-key/live-token/remote-credential patterns: passed.

All fixture users/workspaces/channels/posts/sessions were cleaned by the verifiers.
The disposable PostgreSQL database and role are removed at completion. No real
provider post, provider login, developer-portal write, payment or deployment occurred.

Implementation decisions: optional `Publisher.refreshCredentials` permits a
worker-owned transaction to serialize refresh and persist rotated tokens before
publishing. A late authentication error cannot expire credentials replaced by a
concurrent reconnect. Unknown X/Threads publication outcomes require manual review
because these adapters cannot promise remote idempotency. Threads uses its
documented confidential-client code flow rather than claiming unsupported PKCE.
The installed lazy Auth.js route-wrapper promise is explicitly awaited.

Remaining external steps are the two prepared portal handoffs, provider credits
for X after budget approval, Meta review and a separately authorized real-account
acceptance test. The Media owner's composer can consume `countChannelText` for
its X-specific visual counter; server validation and publishing already enforce
X's official weighted limit. No concurrent Media/Team component was overwritten.
