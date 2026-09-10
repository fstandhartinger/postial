# Postial Claims Audit

Audit basis: app `main` at `d469881`; package repository at `748b6fa` plus the existing local storefront correction `0b661b3`. Registry facts were checked read-only with `npm view n8n-nodes-socialmint`: latest `0.1.2`, description “Create and manage Postial posts and receive signed publishing and approval webhooks”. The verification environment was loaded from `prompts/ENV.md` with `DATABASE_URL="$VERIFY_ADMIN_DATABASE_URL"`; `VERIFY_ALLOW_SHARED_DB` was not set.

| Aussage | Fundstelle | Beleg | Urteil | Korrektur |
|---|---|---|---|---|
| Native n8n node is available | `content/availability.json:19`, `app/docs/api/page.tsx:20`, `content/help/faq.md:33`, `content/help/n8n-postial.md:20` | Registry latest is `0.1.2`; package node classes expose `Postial` and `Postial Trigger`; old app/package text said “awaits publication” | Correct after audit | App now states published `n8n-nodes-socialmint@0.1.2`, with Postial names in n8n. |
| Package installation is possible now | package `README.md:7-13` (corrected in `0b661b3`) | `npm view` returned latest `0.1.2`; package README previously said “After the maintainer publishes” | Corrected in package worktree | README now gives immediate installation and makes a future rename explicitly non-committed. Published npm tarball is outside this change. |
| App API and n8n require Agency | `lib/entitlements.ts:23-25`, `app/app/settings/api/page.tsx:23`, `content/help/n8n-postial.md:7-15` | Entitlements set `api` only for publishing Agency; API settings and help require Agency/trial | Substantiated | No change. |
| Starter/Agency prices and limits | `lib/plans.ts:3-9`, `components/marketing/Plans.tsx:7-14`, `content/availability.json:21-39` | Code defines €19/3 brands/1 seat and €49/15 brands/5 seats; UI derives limits from the same constants | Substantiated | No change. |
| Trial is 14 days with no card | `lib/plans.ts:1`, `components/billing/AccessStatus.tsx:2`, `app/api/stripe/checkout/route.ts:...` | `TRIAL_DAYS=14`; checkout/billing copy and verification cover no-card trial and automatic end without payment method | Substantiated | No change. |
| Live networks are Bluesky, Mastodon, Telegram | `content/availability.json:3-15`, `lib/publishers/index.ts:10-14`, `scripts/verify-publishers.ts:56` | Manifest marks these live; adapters are registered; publisher verifier expects these configured-independent adapters | Substantiated | No change. |
| X, Threads and LinkedIn are immediately usable | `content/availability.json:57-74`, `components/marketing/NetworkAvailability.tsx:6-12`, `lib/publishers/oauth-config.ts:3-9` | OAuth adapters exist, but this environment has no X/Threads/LinkedIn client configuration; UI falls back to “connection not configured”; code requires both ID and secret | Only conditional Early access is supportable | Existing wording consistently says Early access “when configured” and provider conditions; no unconditional availability claim remains. |
| Instagram/Facebook publishing is available | `content/availability.json:16-17,76-85`, `components/marketing/NetworkAvailability.tsx:6-12` | No Instagram/Facebook `Provider` in `lib/publishers/types.ts`; manifest marks both planned | False if stated as live | Kept as planned, platform review required, no release date. |
| Agency approval links are available and client needs no login/seat | `lib/plans.ts:9`, `lib/entitlements.ts:25`, `components/marketing/Plans.tsx:...`, `content/landing.json:124-133` | `approvalLinks` is true only for Agency; approval route is public-token based; UI says reviewers do not consume seats | Substantiated | No change. |
| Bulk editor/API limits | `lib/bulk.ts:3-4,64`, `public/openapi.json:1804-1805`, `app/docs/api/page.tsx:26` | Code caps UI bulk rows at 200 and CSV at 512 KB; OpenAPI documents 1–200, one image/post and 2 MiB request; verify suite passed | Substantiated | No change. |
| API rate limit is 60 requests/minute/key | `app/api/v1/me/route.ts:5`, `public/openapi.json:6,90`, `app/app/settings/api/page.tsx:23` | API response and docs use 60; verifier exercises rate limit and passed | Substantiated | No change. |
| Webhook endpoint limit is 10 and delivery behavior is documented | `lib/api/webhooks.ts:...`, `public/openapi.json:1190-1191`, `README.md:...` | Route/service enforce endpoint cap; OpenAPI and verify suite cover async test, scopes and deletion | Substantiated | No change. |
| n8n node fields and events match implementation | package `nodes/SocialMint/SocialMint.node.ts:17-238`, `nodes/SocialMintTrigger/SocialMintTrigger.node.ts:16-80`, package README sections “Postial node”/“Postial Trigger” | Runtime descriptions expose Postial/Postial Trigger, resource operations, field labels, four event values; package unit/build checks pass | Substantiated | Existing package correction also fixes stale “SocialMint” example and webhook-test description. |
| Changelog/API/help/legal package status | `content/changelog.json:30`, `content/help/index.json:140`, `content/terms.json:...`, `content/privacy.json:...`, `content/dpa.json:...` | These contained stale publication/unavailable wording; registry and code provide the counterevidence | Corrected | Replaced stale “coming/awaits publication” with published `0.1.2`; legal network language now distinguishes live, configured Early access, and planned. |
| Publishing is guaranteed at the scheduled time or after retry | `content/landing.json:140-145`, `content/terms.json:...`, `lib/publishers/http.ts:11,22` | Code has provider/network/auth/content failures and retryable/non-retryable outcomes; terms explicitly say no exact-time guarantee | Substantiated only with caveat | Existing caveat retained: retry is not a guarantee; users must inspect target status. |
| App data is hosted in Germany | `content/privacy.json:...`, `content/dpa.json:...`, `README.md:...` | Legal text identifies Hetzner Germany and separately warns third-party processing may be international | Substantiated with scope | No change; wording does not claim all network/Stripe processing is German/EU. |
| No release dates are promised for future networks | `content/availability.json:78-85`, `content/landing.json:231`, `content/help/faq.md:24-27` | Manifest and rendered marketing/help copy explicitly say no confirmed release date | Substantiated | No change. |

## Corrections delivered

- App-facing stale npm availability claims were corrected in README, changelog, availability manifest, API documentation, FAQ/help index, Terms, Privacy Policy and DPA.
- The package storefront correction is present as commit `0b661b3` in the package repository’s `fix/readme-0.1.3` worktree. It removes the stale publication/rename promise and updates its documentation to the actual published package behavior.
- No secrets, credentials, production database URL, deploy, push or publish operation was used.

## GELIEFERT

- Complete claim inventory grouped by every customer-facing claim class found in app README/OpenAPI/content/legal/UI and package metadata/node definitions.
- Evidence and counterevidence for networks, plan entitlements, prices, limits, durations, package status, webhook behavior and future availability.
- Corrections in `/tmp/postial-claims` and package storefront correction `0b661b3`.

## VERIFIZIERT WIE

- `npx tsc --noEmit` — rc=0.
- `npm run build` — rc=0; standalone artifact produced.
- `npm run verify:all` — rc=0, complete isolated DB run.
- `npm run verify:http` — rc=0, complete sequential HTTP/browser run.
- Public npm metadata checked read-only; no login or publish.
- Final stale-claim scan and JSON/build validation performed after edits.

## OFFEN

- The already published npm tarball/README cannot be changed from this local audit; npm currently reports `n8n-nodes-socialmint@0.1.2`. The corrected package source is committed locally in `0b661b3`; publication of any newer source version remains an external release decision.
- Stripe account settings/prices and live provider developer-app approvals are external systems. The app text therefore does not claim those settings or approvals; X/Threads/LinkedIn remain conditional Early access, while Instagram/Facebook remain planned.
- A live n8n editor/cloud discovery check and live provider publishing are not part of the isolated verification suite; no claim is marked as passed on their behalf.
