# SocialMint → Postial rename

## GELIEFERT

- Product copy, metadata, JSON-LD, landing, pricing/comparison pages, roadmap, help center, legal pages, app shell, join/review pages, API docs/OpenAPI, README, architecture and changelog now use **Postial**.
- `package.json`/lockfile package name is `postial`; `app/icon.svg` is a mint Postial “P” mark.
- Canonical URL remains environment-controlled, with `https://postial.co` as the fallback. `EMAIL_FROM` example defaults to `Postial <noreply@mail.mintapis.com>`.
- Legacy host redirect is opt-in via `LEGACY_HOST_REDIRECT=1`, returns 301 to `https://postial.co<path>`, and excludes `/healthz`.
- Webhooks send `X-Postial-Signature` and retain deprecated `X-SocialMint-Signature` compatibility. API docs describe both.
- Stripe metadata, lookup keys, and IDs were preserved for existing billing compatibility.

## VERIFIZIERT WIE

- `npm run lint` — passed.
- `npx tsc --noEmit` — passed.
- `npm run build` — passed.
- `npm run verify:all` — passed.
- Standalone server: `/`, `/pricing`, `/docs`, `/impressum`, `/privacy`, `/terms`, `/legal/dpa`, `/docs/api`, `/openapi.json` checked for Postial output. The API pages intentionally retain the deprecated legacy signature name.
- Redirect: old host with `LEGACY_HOST_REDIRECT=1` → 301; `/healthz` → 200. Without the switch, old host → 200.
- Playwright screenshots at 390px and 1280px are in `work/rename-code-evidence/` for landing and app-shell routes.
- JSON validation, `git diff --check`, and secret-pattern review completed; no secret values were printed or committed.

## OFFEN

- Production domain/DNS, OAuth, Stripe branding, hosting configuration, repository rename, and external n8n publication remain operational follow-up tasks from `RENAME.md`.
- Required compatibility/history matches intentionally retained: deprecated `X-SocialMint-Signature`, one changelog history mention, and legacy Stripe metadata/lookup IDs.
- Implementation commit SHA: `da513231197137ee461accb2b58213b52aa3c1d9`.
