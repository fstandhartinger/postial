# SocialMint

Approve and publish social posts across brands, with recoverable failures. API + n8n node.

Milestone 1A foundation: Next.js 16 (App Router, standalone), strict TypeScript,
Tailwind CSS v4, locally bundled Inter, small UI primitives, Drizzle + PostgreSQL,
and Auth.js v5 beta with the Drizzle adapter and database sessions.

## Local development

Use Node.js 22 and a PostgreSQL database:

```sh
npm ci
cp .env.example .env.local
# Fill in environment values; keep this file private.
set -a
. ./.env.local
set +a
npm run db:migrate
npm run dev
```

Next.js reads `.env.local` automatically; the migration script reads process
environment variables, so export them as shown above. Open http://localhost:3000.

```sh
npm run db:generate  # after changing db/schema.ts; commit drizzle/ migrations
npm run lint
npm run build
npm start
```

## Environment

- `DATABASE_URL`: PostgreSQL connection string, required at runtime. All clients
  use `prepare: false` for PgBouncer transaction pooling.
- `AUTH_SECRET`: strong random session/authentication secret, required for auth.
- `AUTH_URL`: canonical app origin; production: https://socialmint.app.mintapis.com.
- `AUTH_TRUST_HOST`: set to `true` behind the trusted hosting proxy; Auth.js is
  explicitly configured with `trustHost: true`.
- `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`: both enable Google OAuth. Register
  `/api/auth/callback/google` on the app origin as the provider callback URL.
- `SMTP_URL`, `EMAIL_FROM`: both enable Nodemailer magic links. Links return via
  `/api/auth/callback/nodemailer`. Never configure real email delivery for smoke tests.
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`: server-only billing credentials.
  Redirect-only Checkout does not require a publishable key.
- `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_AGENCY`: required billing price identifiers exposed
  by `lib/plans.ts`; Starter €19/month, Agency €49/month, trial 14 days.
- `NEXT_PUBLIC_APP_URL`: public canonical origin, reserved for integrations.

Providers are enabled only when their complete configuration is present. With
neither provider configured, `/login` renders a friendly message and disabled
options. `/app` verifies a database session using `auth()` before accessing data.
First access creates a workspace and owner membership in one transaction.
A signed Stripe webhook starts subscription access after Checkout. A row lock serializes concurrent onboarding requests for a user.
Existing workspace members reuse their workspace.

## Docker / Sandy deployment

Use Sandy/Coolify with this Dockerfile and domain
https://socialmint.app.mintapis.com. Container port: **3000**. Healthcheck:
**GET /healthz** (200 with `{ok:true,db:true,version}`; database failure or a
2-second deadline returns 503 with `{ok:false}`). Supply secrets as runtime
environment variables, never build arguments. The build needs no database or auth
credentials; Inter is bundled locally and requires no font download.

```sh
sudo -n docker build -t socialmint:dev .
sudo -n docker run --rm --env-file .env.local -p 3000:3000 socialmint:dev
```

The Node 22 Alpine image runs as UID 1001. Startup runs checked-in migrations
before `exec node server.js`; migration failure prevents server startup. Deploy
one migrating instance at a time (serialize concurrent rollouts). Ensure the
runtime database user can create/update the schema. Migration dependencies are
included explicitly alongside the standalone Next.js output.

## Scope and validation

Foundation: workspace ownership, auth and billing are implemented.
Marketing: landing, pricing, legal pages and the interactive approval demo are implemented.
Product: channel connections, calendar, approval links, publishing, API and n8n
remain milestone 2 work, advertised as early access with a September 2026 rollout.
The owner must verify company registration details and provide the DPA on request. Google/SMTP credentials enable their
respective providers; no mail or external login is exercised by the smoke checks.
Network integrations and production deployment are separate work.

See `VERIFICATION.md` for executed milestone checks and dependency audit findings.
Implementation references: [Next.js installation](https://nextjs.org/docs/app/getting-started/installation)
and [Auth.js Drizzle adapter](https://authjs.dev/getting-started/adapters/drizzle).


## Billing

Authenticated workspace owners start Starter (€19/month, 3 brands, 1 seat) or
Agency (€49/month, 15 brands, 5 seats, approval links) through
`POST /api/stripe/checkout` with `{"plan":"agency"}`. First-time pricing visitors
get a workspace automatically. Anonymous requests return 401 and CheckoutButton
opens `/login?next=/pricing&plan=agency`. Owner-only billing rejects cross-origin
requests and ambiguous multiple owned workspaces.

Checkout offers a 14-day trial without a card; missing payment details cancel it
at trial end. Success returns to
`/app?checkout=success&session_id={CHECKOUT_SESSION_ID}`; cancellation returns to
`/pricing?checkout=cancelled`. The success banner grants no access.
`/app/billing` displays the reconciled plan, status and dates, and opens Stripe's
Portal through `POST /api/stripe/portal`. Canceled/incomplete_expired/unpaid
subscriptions can restart through a paid Checkout; repeated free trials are not offered.

Set server-only `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
`STRIPE_PRICE_STARTER`, `STRIPE_PRICE_AGENCY`, and `STRIPE_PORTAL_CONFIG`.
Set `NEXT_PUBLIC_APP_URL` to the canonical origin; it falls back to `AUTH_URL`.
Never expose secret keys via NEXT_PUBLIC variables. Use separate sandbox
credentials, prices and portal configuration for payment lifecycle testing.

Run `npm run db:migrate` before serving traffic. Both schema files are included
in Drizzle discovery. Unique workspace/customer/subscription constraints,
transactional advisory locks and `stripe_processed_events` make updates
idempotent. `stripe_billing_state` persists Checkout and the fixed past-due grace
start, with cascading workspace cleanup. The Node webhook reads `request.text()`,
verifies the Stripe signature, ignores unknown events with 200, and fetches the
latest subscription outside transactions, then checks the local revision under
the workspace lock before upserting (retrying on concurrent changes).
Register checkout.session.completed, customer.subscription.created/updated/deleted,
invoice.paid and invoice.payment_failed at `/api/stripe/webhook`.

`hasAccess` permits active/trialing subscriptions and seven days of past-due grace.
New workspaces have no plan until Stripe confirms a subscription; legacy local
trial rows without a Stripe subscription ID do not grant access. In M1, lack of
access displays a billing notice while keeping `/app` available.

### Billing test plan

Export credentials securely in the shell, including DATABASE_URL for the local
database and the Stripe environment above. Never log credential values.
Set NEXT_PUBLIC_APP_URL and AUTH_URL to `http://localhost:3992`.

- `npm run lint`, `npx tsc --noEmit`, `npm run build`, `npm run db:migrate`.
- With port 3992 free: `npx tsx scripts/verify-webhook.ts`. This HTTP harness serves
  the actual webhook route on 3992 using real PostgreSQL and signed raw payloads.
  Only Stripe subscription/price retrieval is mocked, so a synthetic event
  cannot create live subscriptions. Checks signed update 200, duplicate and
  concurrent delivery with exactly one row/event, invalid/missing signature 400,
  unknown event 200, and grace boundaries. Fixtures are removed in finally.
- `npx tsx scripts/verify-workspace.ts`: concurrent onboarding, no unearned trial,
  owner membership and database session lifecycle.
- Start the built application with `PORT=3992 npm start`, then run
  `npx tsx scripts/verify-billing.ts`: anonymous 401, protected page redirect,
  authenticated Checkout and Portal URLs, reusable Checkout, correct redirects,
  paid restart without a second trial, shared 429/Retry-After, and cross-origin 403. This explicitly creates a temporary Stripe customer and
  an uncompleted Checkout, expires the session, deletes the customer and database
  fixtures. It never follows Checkout or creates a payment. Use LIVE only with
  explicit authorization; use sandbox for ordinary development.
- In a Stripe sandbox, complete Checkout and test trial expiry, plan changes,
  cancellation, failed invoices and recovery through real delivered webhooks.
  Payment lifecycle testing is separate from the non-purchasing LIVE smoke test.

## Early-access billing and operations

The 14-day trial starts in Checkout without a card. Without a payment method, your subscription ends automatically at trial end and you are not charged. If you add a payment method in the customer portal during the trial, billing starts at the displayed price when the trial ends. You can cancel anytime.

`workspaces.trial_used_at` records consumed trial eligibility independently from
subscription purchase eligibility. Migration backfills historical subscriptions.
Retired subscription IDs prevent late events from replacing a newer contract.
Checkout uses a ten-minute persistent lease, short DB writes and targeted Stripe
customer metadata search. The customer mapping is saved before Checkout creation.
Checkout and Portal share a limit of five calls per user per minute (429 with
Retry-After). This limit is in memory per process; use a shared store before
running multiple replicas. Stripe requests time out after ten seconds per attempt.
Startup warns about missing configuration by variable name only. `/healthz`
remains database liveness, not auth/billing feature readiness. Anonymous protected
pages redirect before adapter/database access, including without DATABASE_URL.
Login retains validated internal `next` and starter/agency `plan` through both
providers' Auth.js callbackUrl; the continuation page starts a same-origin POST.
Security headers apply centrally; inline scripts/styles support Next's renderer.

## Known issues

Dependency check (2026-09-08): `npm outdated nodemailer next-auth
@auth/drizzle-adapter` and `npm audit` show no compatible patched version of the
Auth.js v5 beta chain. Nodemailer 10.0.1 is published, but installed Auth.js/core
accept only ^7.0.7 or ^8.0.5; current 8.0.11 is affected by the raw/resolveContent
advisories (GHSA-p6gq-j5cr-w38f, GHSA-8m3c-c648-2xjj). Auth.js supplies fixed mail
content; this app exposes neither raw nor resolveContent as user-controlled input.
The audit reports four high package nodes in that chain and four moderate nodes
from esbuild/Drizzle development tooling. No forced or unsupported major downgrade
was applied. Do not expose development servers publicly. Recheck compatible Auth.js
releases before enabling production email login. External provider login and a
complete payment lifecycle require a separate acceptance test; LIVE verification
only creates uncompleted Checkout sessions and deletes the temporary customers.

### Browser regression tests

- `PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node scripts/verify-fixer-browser.mjs`:
  run the production app on 3992 plus a second instance without DATABASE_URL on
  3995. Checks public pages/security headers at 320/1440, anonymous Agency CTA,
  missing-DB redirects and (with DATABASE_URL) temporary database-session UI
  fixtures for automatic checkout continuation, retry and expired Portal login.
  Checkout is intercepted in this UI test; no provider login or payment occurs.
