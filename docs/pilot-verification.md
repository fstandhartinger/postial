# Pilot verification — 2026-09-09

Implemented workspace Channels and Agency Approvals, daily channel validation and
media retention, and Duplicate → fresh draft composer. Migration 0011 adds
`channels.last_health_error` and `maintenance_runs`.

Passed on the local PostgreSQL database and local production standalone build:

- `npm run db:migrate`, `npm run lint`, `npx tsc --noEmit`, `npm run build`.
- `verify-pilot.ts`: AUTH_EXPIRED status, daily interval, five-channel budget,
  disconnected skip, concurrent checks, renewed OAuth credential persistence,
  approval groups/filter/latest comment, duplicate fields/draft/tenant isolation.
- `verify-retention.ts`: old unused deletion, old references on former origins and
  query-string URLs preserved, fresh uploads preserved, persistent daily guard.
- All existing TypeScript verifiers: entitlements, workspace, core, publishers,
  oauth, fixer3-migration, api (harness and standalone), webhook, core-http,
  approvals, media, team, appshell, fixer2-browser, fixer3-browser, billing.
- Billing used documented existing Stripe price/portal configuration; the test
  only creates temporary customer/uncompleted Checkout/Portal objects and cleans
  them up. No checkout completion, payment, provider login or real publishing.
- Changed-file scan against environment secret values and credential patterns;
  `git diff --check`.

Browser evidence is saved outside the checkout at
`/path/to/postial/work/pilot-evidence/`: Channels and Approvals at
390/1280, empty states, Starter upgrade. No horizontal page overflow or page
errors; keyboard focus and brand filtering checked using synthetic DB sessions.

The initial build required replacing an external node_modules symlink with a
local copy (Turbopack rejects symlinks outside its filesystem root). The initial
billing run lacked price/portal IDs; the documented configuration passed.

Additional browser actions passed on the final build: clipboard copy, regenerated
link matches persisted token, old public link 404/new link 200; Duplicate from
Posts opens the new draft composer with text, brand, two channels, media and link
preserved. DB and UI confirm no schedule, approval token/decision, previous
attempts or next-attempt time. Duplicate is also present on status pages. Eight
PNGs include `duplicate-composer-1280.png`. Existing HTTP, marketing, marketing
browser and fixer-browser JavaScript verifiers also passed.
