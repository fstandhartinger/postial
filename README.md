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
npm start  # node .next/standalone/server.js
```

The build post-step copies public and .next/static into .next/standalone.
Docker copies the same assets into its standalone runtime root and runs node server.js.


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
Product: brands, channel connections, composer, calendar and publishing worker are
implemented, including public customer approval links. Public API v1 is implemented; the native n8n node remains upcoming work.
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
requests and uses the selected workspace after verifying its membership role.

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

`lib/entitlements.ts` is the single access authority: trials end at trialEnd; active and past_due plans require currentPeriodEnd plus three days to be in the future. Past-due access additionally ends seven days after pastDueSince. Missing dates fail closed.
New workspaces have no plan until Stripe confirms a subscription; legacy local
trial rows without a Stripe subscription ID do not grant access. Without access, reading and drafts remain available, but scheduling and retries are disabled.
The worker holds due targets until access returns. Brands beyond a downgraded plan limit are read-only; the oldest brands remain active.

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

## Product core

`/app` provides workspace navigation, brands and channel connections, a composer,
post status/history with retry and skip controls, and month/week calendars.
Starter supports 3 brands, Agency 15; without an active subscription/trial the
Starter limit applies. Credentials are AES-256-GCM encrypted at rest using
`APP_ENCRYPTION_KEY` (base64, exactly 32 random bytes). Preserve this key across
restarts; replacing it requires reconnecting channels. Never expose it publicly.
Reconnecting the same provider account updates its existing channel credentials.

The composer validates channel ownership, provider text limits, four HTTPS media
URLs, and dates in the brand's IANA timezone. Ambiguous/nonexistent DST minutes
are rejected. Drafts and pending approval requests cannot publish. The customer
approval link sets the post status to `approved`; the worker activates targets at
`scheduled_at`. Editing is restricted to drafts and pending/changes-requested posts.

The Node instrumentation starts one publishing timer per process (30 seconds).
`POST /api/internal/tick` also runs a batch, authenticated by `x-cron-secret`
matching server-only `CRON_SECRET`. PostgreSQL `FOR UPDATE SKIP LOCKED` reserves
10 due targets before network calls. Attempts fence stale responses; retries use
1/4/15/60-minute delays and provider Retry-After, with failure after five attempts.
Authentication expiry requires reconnection; rejected content fails immediately.
Attempts interrupted for ten minutes are recovered within the same five-attempt budget.
Each publish has a 90-second deadline across all requests and a 30-second lease heartbeat.
Mastodon retries use the same Idempotency-Key; Bluesky uses a deterministic record key
and checks getRecord before createRecord. Telegram uncertain outcomes enter needs_review:
check the channel, then manually retry or skip. No automatic retry leaves needs_review.
Manual retry starts a new five-attempt budget. Published warnings persist on the target,
in history and on the status page; add omitted content manually to avoid duplicates.
Outbound HTTPS validates every DNS address, pins connections, bounds redirects and streams
(adapter image limits, 64 KB JSON). Channel metadata persists the Mastodon instance text limit.

Connect channels via **Brands → select a brand → Connect a channel**:
[Bluesky](docs/connect-bluesky.md), [Mastodon](docs/connect-mastodon.md),
[Telegram](docs/connect-telegram.md). SocialMint supports four images per post.


Verification: `npm run db:generate`, `npm run db:migrate`, `npm run lint`,
`npx tsc --noEmit`, `npm run build`, and `npx tsx scripts/verify-core.ts`.
The core script uses PostgreSQL fixtures and a test-process-only Mastodon adapter;
it publishes no real content and deletes fixtures. Run `npx tsx scripts/verify-core-http.ts` against a local server on port 3993
(or set `CORE_HTTP_URL`) to check session-protected routes and cron authentication.
Keep the worker fixture run separate from a running worker, which would otherwise
try to process synthetic channels.

## API

Public REST API v1 is available on `/api/v1`. Agency owners (including active
Agency trials) manage scoped API keys and signed webhooks at `/app/settings/api`.
Keys and webhook signing secrets are shown once. Keys are SHA-256 hashed; webhook
secrets are encrypted with `APP_ENCRYPTION_KEY`. Revoked keys return 401; a downgrade
or inactive Agency entitlement returns 403. Never put keys in query strings.

See [API documentation](/docs/api) and [OpenAPI 3.1](public/openapi.json) for
endpoints, examples, signature verification and n8n HTTP Request setup. Use
`Authorization: Bearer $SOCIALMINT_API_KEY`. All responses use snake_case,
errors use `{error:{code,message}}`, and reads never expose channel credentials.

Post creation and target retries reuse the UI server service in
`lib/api/post-service.ts`. Requests are limited to 60/minute/key in PostgreSQL;
429 includes Retry-After. POST /posts supports a transactionally serialized
Idempotency-Key for 24 hours, with a persisted exact response and 409 on changed
input. Omit scheduled_at for drafts. API deletion rejects posts with started
publishing attempts, even if the aggregate status is scheduled.

Webhook events commit to an outbox alongside publishing status and customer
approval transactions. A separate guarded deliverWebhooksTick runs after publishing in the same 30-second interval, with a 10-second budget, concurrency four and five-second request deadlines. It claims batches
with row locks and fenced leases, and retries at 1/5/30/30 minutes (five attempts).
Outbound production requests use the existing DNS-pinned SSRF-safe fetcher and
never follow POST redirects. Receivers must verify the raw bytes, enforce a
five-minute timestamp tolerance, and deduplicate payload.id. Approval event data contains only post_id, brand_id, decision, decided_at, has_comment and post_url. GET /api/v1/posts/{id} exposes authorized approvals[] history. Migration 0007 removes historical outbox names/comments. Disable pauses deliveries; Enable resumes them; Delete cancels open deliveries and removes signing credentials while retaining logs. Entitlement pauses consume no attempts and resume automatically. Requests already in flight may reach the receiver. Logs retain safe
HTTP status only. API settings show the latest 20 deliveries. Expired idempotency
records are removed by the tick; provision retention for long-term delivery logs.

Validation: `npx tsx scripts/verify-api.ts` uses isolated database fixtures and a
local HTTP receiver, checks route handlers over HTTP, auth, scopes, tenancy,
idempotency, validation, deletion, rate limits, webhook signatures and backoff,
and removes fixtures in finally. Set DATABASE_URL to the test database. Only
non-production tests may set WEBHOOK_ALLOW_LOOPBACK=1; it permits literal
http://127.0.0.1 receivers and has no effect in production. No provider publishing,
login, billing purchase or live customer data is required. Run migrations first.

Set `API_HTTP_URL=http://127.0.0.1:3998` to run the same API suite against a
running production build, including public docs, the anonymous settings redirect
and a synthetic owner session (without provider login). The default harness
passes an empty context on routes without parameters, matching Next.js runtime.
On 2026-09-09 both modes passed, including eight concurrent idempotent creates,
secret-free settings HTML, scoped/foreign-resource rejection and cleanup.
Migration 0006, lint, TypeScript, production build, Redocly OpenAPI validation and
a changed-file scan against environment secrets and credential patterns passed.

### Webhook management API (cycle 4)

Create a key with `webhooks:manage` in API settings; existing keys keep their
original scopes. `POST /api/v1/webhooks` accepts `{url, events}` and returns 201
with `{id, url, events, active, secret}`. Save the secret once. Public HTTPS and
the same SSRF checks as the UI apply. Ten non-deleted endpoints per workspace
(including disabled) are allowed; concurrent registrations respect this limit (422).

- `GET /api/v1/webhooks`: `{data: [...]}` without secrets.
- `POST /api/v1/webhooks/{id}/test`: 202, queues a signed `ping` (`data.test=true`).
- `GET /api/v1/webhooks/{id}/deliveries?limit=20`: latest logs, limit 1–100;
  logs remain accessible after endpoint deletion.
- `DELETE /api/v1/webhooks/{id}`: 204, cancels open deliveries and destroys credentials.

Post detail includes `approvals[]` with decision, reviewer_name, comment and
created_at (`decided_at` retained for compatibility). When requires_approval is
true, `approval_url` contains the link, or null for a draft without a token.
The docs include registration, every event payload and Node signature verification.
n8n community node: n8n-nodes-socialmint (coming to npm).

The API verifier additionally checks management scopes, signed ping, safe lists,
tenancy, SSRF rejection, concurrent endpoint limits and cancellation through HTTP.
The optional workspace events polling endpoint is not included.

Verified 2026-09-09: lint, TypeScript, production build, Redocly OpenAPI validator,
changed-file secret scan and `verify-api.ts` passed both in the route harness and
against the built Next.js server. Local receiver registration/delivery uses the
non-production harness; the production server explicitly rejects loopback URLs.
All temporary database fixtures were removed by the verifier.

## Image uploads

The composer accepts drag-and-drop and file selection with progress, thumbnails and
removal, alongside external HTTPS URLs. Uploads are public capability URLs; anyone
with the URL can view the image. Removing a thumbnail only detaches it from the
post. Unused uploads remain until explicitly deleted; automatic retention is future work.

`POST /api/media` accepts a session-authenticated multipart `file` and optional
`brand_id`. `POST /api/v1/media` requires Agency API scope `posts:write` and accepts
the same multipart body or JSON `{ "data": "<standard Base64>", "brand_id": "<optional UUID>" }`.
Both return 201 `{id,url,width,height,bytes}`. Pass returned absolute URLs in
`media_urls` when creating posts. Sharp fully decodes images and determines dimensions. JPEG, PNG and WebP are
re-encoded in their original format, applying orientation and stripping metadata.
GIFs retain their bytes after decoding all frames; arbitrary comment/application
extensions are rejected. Limits are at most 200 frames and 50 million
pixels across frames. Each frame/still image is limited to 25 megapixels. Input
and output are at most 5 MiB; output quality is reduced if needed, or rejected with
422. Damaged/incomplete images and appended payloads are rejected. Four images per post. Workspace storage: Starter 200 MiB; active Agency 2 GiB. Oversize
returns 413, invalid images/exhausted storage return 422. Uploads have a 30/minute
per-user/workspace process budget (use shared storage before multiple replicas);
API keys additionally retain their persistent API budget.

Postgres `media_assets` stores the normalized bytes (validated original bytes for GIF) (`bytea`). Set
`NEXT_PUBLIC_APP_URL` to the public HTTPS origin. `GET /m/{id}` is unauthenticated,
with 256-bit random IDs, immutable one-year caching, ETag and nosniff. Never reuse
IDs. `DELETE /api/media/{id}` requires a session in the owning workspace and
rejects assets referenced by any post (422); other workspaces receive 404.
Post creation and deletion serialize asset checks to prevent dangling references.
Provider downloads retain DNS validation and connection pinning, including our
own public host. `MEDIA_ALLOW_LOOPBACK=1` permits only canonical
`http://127.0.0.1:<port>/m/{id}` during non-production verification; it cannot enable
private addresses in production. Provider-specific limits still apply (Bluesky
limits its download to 1 MB). Adapter limits are X 5 MB, Bluesky 1 MB,
Mastodon 16 MB, Telegram 10 MB and Threads 8 MB (decimal). Over-limit downloads
produce CONTENT_REJECTED or the adapter’s persisted omission warning. Telegram and
Threads preflight image downloads before passing public URLs to their providers.

Verification against the **production standalone server**, without a loopback
publishing exception:

```sh
npm run build
# Export DATABASE_URL, AUTH_SECRET, APP_ENCRYPTION_KEY in both shells first.
# Terminal 1 (server):
unset MEDIA_ALLOW_LOOPBACK
PORT=4005 HOSTNAME=127.0.0.1 AUTH_URL=http://localhost:4005 \
APP_URL=http://localhost:4005 NEXT_PUBLIC_APP_URL=http://localhost:4005 npm start
# Terminal 2 (verifier runs outside NODE_ENV=production):
MEDIA_HTTP_URL=http://localhost:4005 PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs \
npx tsx scripts/verify-media.ts
```

`server.js` sets NODE_ENV=production. Upload URL construction supports HTTP on
literal loopback/localhost for local tests and never performs a network fetch.
Publisher downloads still reject private addresses in production, even if
MEDIA_ALLOW_LOOPBACK=1. The verifier enables the exception only in its own test
process, then explicitly verifies the production denial. Missing/invalid upload
origin configuration returns 422 with a readable message. Unexpected API errors
return 500 with X-Request-ID; structured logs contain route, error class and request
ID, without payloads, user data or exception messages. Screenshots are saved under
`work/fixer5-evidence/`, including OAuth error banners at 390/1280.

## Teams and workspace selection

Owners manage members and seven-day invitation links at `/app/settings/team`.
Starter allows one seat; active Agency allows five. Invitations do not reserve
seats: creation and acceptance both check the current plan, and acceptance is
serialized with team changes. At most ten links can be created per workspace
in a rolling hour, including revoked/used links. Links are bearer credentials:
share privately; only their SHA-256 hashes are stored, and the link is shown once.
Set `APP_URL` (fallback `NEXT_PUBLIC_APP_URL`, then `AUTH_URL`) to the public origin.
No email is sent. `/join/<token>` retains the destination through login and consumes
the invitation only after an authenticated POST. Expired, revoked, used and
already-member cases have explicit messages.

Owners can promote/demote members and manage billing, API settings and the team.
Editors manage brands, channels and posts. Removing yourself and demoting the
last owner are rejected on the server. Existing owner memberships are preserved;
legacy admin/member enum values remain compatible and have editor-level access.
Existing membership join dates are backfilled to migration time.

The account menu switches between memberships using the HttpOnly, SameSite=Lax
`sm_ws` cookie. Every request validates membership; invalid/stale selectors fall
back to the oldest workspace. Onboarding creates a workspace only for users with
no memberships. Billing and API administration use the selected membership role.

Team verification: run the built server on localhost:3997 with test DATABASE_URL,
AUTH_SECRET and local AUTH_URL/NEXT_PUBLIC_APP_URL, then
`npx tsx scripts/verify-team.ts`. Set PLAYWRIGHT_MODULE if Playwright is elsewhere.
The verifier creates and deletes synthetic database sessions, exercises the real
join POST, checks editor billing 403, settings guards, roles, seat limits,
concurrent consumption, expiry, revocation, last-owner protection, rate limits and
workspace switching. Screenshots at 390/1280 are in `work/team-evidence/`.

### Workspace credentials and offboarding

The active workspace is resolved from `sm_ws` and current membership for media,
quotas, API-key/webhook management, Team and Billing. Invalid or foreign selectors
are cleared and fall back to the oldest membership. Editors can connect all
supported channels, including OAuth; Billing, Team, API keys and webhooks remain
owner-only.

API keys and webhook endpoints belong to the workspace. Removing their creator
from the team does **not** revoke keys or disable webhooks. API settings show each
key’s creator; Team shows the member’s active key count before removal. During
offboarding, review and revoke any exposed keys and replace webhook endpoints to
rotate their signing secrets. Actual deletion of a user record is different: the
existing API-key creator foreign key uses ON DELETE CASCADE and deletes that
user’s keys. Membership removal does not delete the user record.

Image processing reference: [Sharp output metadata policy](https://sharp.pixelplumbing.com/api-output/).
Linux-musl support: [Sharp installation](https://sharp.pixelplumbing.com/install/).
