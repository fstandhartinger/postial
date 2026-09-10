# Postial

Approve and publish social posts across brands, with recoverable failures. API + n8n node.

**Version 0.2.0.** Stack: Next.js 16 (App Router, standalone), strict TypeScript,
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
- `AUTH_URL`: canonical app origin; production: https://postial.co.
- `AUTH_TRUST_HOST`: set to `true` behind the trusted hosting proxy; Auth.js is
  configured with `trustHost` only when `AUTH_TRUST_HOST=true`.
- `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`: both enable Google OAuth. Register
  `/api/auth/callback/google` on the app origin as the provider callback URL.
- `SMTP_URL`, `EMAIL_FROM`: both enable Nodemailer magic links. Links return via
  `/api/auth/callback/nodemailer`. Never configure real email delivery for smoke tests.
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`: server-only billing credentials.
  Redirect-only Checkout does not require a publishable key.
- `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_AGENCY`: required billing price identifiers exposed
  by `lib/plans.ts`; Starter €19/month, Agency €49/month, trial 14 days.
- `NEXT_PUBLIC_APP_URL`: public canonical origin, reserved for integrations.
- `GOOGLE_SITE_VERIFICATION`, `BING_SITE_VERIFICATION`: optional search-engine
  ownership tokens. When set, Postial emits the corresponding Google
  `google-site-verification` and Bing `msvalidate.01` meta tags in the root
  document; blank values are ignored.
- `REDIRECT_HOSTS`: comma-separated hostnames that redirect permanently to `NEXT_PUBLIC_APP_URL`; defaults to `www.postial.co,postial.net,www.postial.net`. `socialmint.app.mintapis.com` redirects only when `LEGACY_HOST_REDIRECT=1`.

### SEO / Verification

Set `GOOGLE_SITE_VERIFICATION` and/or `BING_SITE_VERIFICATION` in the runtime
environment to verify the production site with Google Search Console and Bing
Webmaster Tools. The values are server-only and are rendered as meta tags on
the root document. Leave either variable empty when that provider is not being
verified.

Providers are enabled only when their complete configuration is present. With
neither provider configured, `/login` renders a friendly message and disabled
options. `/app` verifies a database session using `auth()` before accessing data.
First access creates a workspace and owner membership in one transaction.
A signed Stripe webhook starts subscription access after Checkout. A row lock serializes concurrent onboarding requests for a user.
Existing workspace members reuse their workspace.

## Docker / Sandy deployment

Use Sandy/Coolify with this Dockerfile and domain
https://postial.co. Container port: **3000**. Healthcheck:
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
implemented, including public customer approval links. Public API v1 is implemented; the native n8n node is published on npm as `n8n-nodes-socialmint` 0.1.2 and appears as Postial in n8n.
The owner must verify company registration details. The DPA is available at `/legal/dpa` with owner acceptance in `/app/settings/legal`. Google/SMTP credentials enable their
respective providers; no mail or external login is exercised by the smoke checks.
The Sandy deployment is documented below. External provider approvals/sign-in and
a complete Stripe payment lifecycle remain separate acceptance checks.

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
start, with cascading workspace cleanup. The Node webhook reads bounded raw bytes (512 KiB, 10-second deadline),
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
  paid restart without a second trial, shared 429/Retry-After, and cross-origin 403. The verifier uses a mocked Stripe SDK with the real handlers and DB sessions, plus the running app for pages. No Stripe customer, provider login or payment is created.
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
Retry-After). This limit is atomic in PostgreSQL and shared across replicas. Stripe requests time out after ten seconds per attempt.
Startup fails on missing DATABASE_URL, AUTH_SECRET, CRON_SECRET or encryption keys, invalid keys or conflicting canonical origins. Builds remain secret-free. `/healthz` checks migrations and worker progress as described below.
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
  run a built app at `VERIFY_BASE_URL` (legacy default 3992). Checks public pages/security headers at 320/1440, anonymous Agency CTA,
  protected redirects and (with DATABASE_URL) temporary database-session UI
  fixtures for automatic checkout continuation, retry and expired Portal login.
  Checkout is intercepted in this UI test; no provider login or payment occurs.

### Isolated verification and fixture cleanup

`npm run verify:all` and `npm run verify:http` require `VERIFY_ADMIN_DATABASE_URL`
for a **dedicated disposable PostgreSQL server**, with bootstrap database and role
`postial_verify_admin`. They create a unique database plus a restricted matching
login, validate the actual session/search path/database permissions, migrate and
run fixtures there, then remove both database and role. Setup failure and signals
are covered before the first migration. No production URL/role, port rewriting,
shared-schema fallback, `VERIFY_ISOLATED_SCHEMA`, or `VERIFY_ALLOW_SHARED_DB`
fixture bypass is supported. Bootstrap databases must deny PUBLIC CONNECT.
See [verification safety and commands](scripts/VERIFICATION-SAFETY.md).

Fixtures use `@fixture.postial.invalid` and `fixture:` workspace names. Fixture
cleanup and the isolated database lifecycle are separate safety boundaries.
`fixture-sweep` is a separate legacy operations tool, **not** an isolated verifier;
its name-based production guard does not establish target safety. Do not run it
as part of verification. Any production cleanup needs a separately reviewed exact
target and explicit approval; this fixture suite neither requires nor authorizes it.

## Product core

`/app` provides workspace navigation, brands and channel connections, a composer,
post status/history with retry and skip controls, and month/week calendars.
Starter supports 3 brands, Agency 15; without an active subscription/trial the
Starter limit applies. Credentials are AES-256-GCM encrypted at rest using
`APP_ENCRYPTION_KEY(S)` (base64, exactly 32 random bytes per key). Preserve read keys across restarts and rotate with the versioned keyring described below. Never expose keys publicly.
Reconnecting the same provider account updates its existing channel credentials.

The composer validates channel ownership, provider text limits, four HTTPS media
URLs, and dates in the brand's IANA timezone. Ambiguous/nonexistent DST minutes
are rejected. Drafts and pending approval requests cannot publish. The customer
approval link sets the post status to `approved`; the worker activates targets at
`scheduled_at`. Unstarted scheduled and approved posts can also be edited; saving approved content resets approval. Date-only rescheduling preserves approval.

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
[Telegram](docs/connect-telegram.md). Postial supports four images per post.


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
records are removed by the tick; webhook deliveries are deleted after 30 days by daily retention.

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
- `POST /api/v1/webhooks/{id}/test`: 202, queues a signed sample of the first subscribed event with top-level `test=true` (or `ping` when no events are subscribed) and `X-Postial-Test: 1`.
- `GET /api/v1/webhooks/{id}/deliveries?limit=20`: latest logs, limit 1–100;
  logs remain accessible after endpoint deletion.
- `DELETE /api/v1/webhooks/{id}`: 204, cancels open deliveries and destroys credentials.

Post detail includes `approvals[]` with decision, reviewer_name, comment and
created_at (`decided_at` retained for compatibility). When requires_approval is
true and the key also has `posts:write`, `approval_url` contains the link, or null for a draft without a token. Keys with only `posts:read` receive status/history without an approval URL.
The docs include registration, every event payload and Node signature verification.
n8n community node: `n8n-nodes-socialmint` 0.1.2 is published on npm and appears as Postial in n8n; only the package name retains the former brand.

The API verifier additionally checks management scopes, signed test events, safe lists,
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
post. Unreferenced uploads older than 30 days are deleted by the daily retention job.

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
per-user/workspace PostgreSQL budget shared across replicas;
API keys additionally retain their persistent API budget.

Postgres `media_assets` stores the normalized bytes (validated original bytes for GIF) (`bytea`). Set
`NEXT_PUBLIC_APP_URL` to the public HTTPS origin. `GET /m/{id}` is unauthenticated,
with 256-bit random IDs, private/no-store caching, ETag and nosniff. Never reuse IDs. Deleted IDs return 410 using minimal tombstones. Copies previously cached under the old one-year policy cannot be recalled. `DELETE /api/media/{id}` requires a session in the owning workspace and
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

## Pilot operations (cycle 6)

`/app/channels` lists connection health across workspace brands, with reconnect,
manual validation (at most once per minute), disconnect, last successful post and
latest error. The publishing tick validates at most five channels per tick and
one time per 24 hours per channel, skipping disconnected accounts. Channel row
locks serialize checks with OAuth token refresh/reconnect; logs include only
provider and safe error code. Run migration 0011 before starting the worker.

`/app/approvals` groups Agency approval posts into Awaiting, Changes requested,
Approved and Published, with brand filtering, latest customer feedback, copy and
regenerate controls. Drafts remain Awaiting; delivery/failure states stay under
Approved with their exact status visible. Published links cannot be regenerated.
Starter sees an Agency upgrade notice.

Duplicate on the post list/status creates a fresh draft and opens the composer.
Text, media, brand, link and channel selections are retained (including inactive
channels); schedule, approval links/decisions and publishing attempts are reset.
Inactive channels must reconnect before scheduling, but drafts remain saveable.

The worker also removes uploads older than 30 days if no post references them.
A daily process guard plus transactional `maintenance_runs` DB guard prevents
repeat cleanup across replicas. Workspace locks coordinate deletion with post
writes. Logs contain removed count and bytes; referenced assets survive across
app-origin changes. Run `npx tsx scripts/verify-retention.ts` and
`npx tsx scripts/verify-pilot.ts` against an isolated local test database, before
starting a standalone worker. Both remove their fixtures.

## Customer workflow fixes (cycle 6)

Migration 0012 adds shared workspace notifications, versioned DPA acceptances,
image alt-text storage and an endpoint kind for team alerts. Availability on the
landing page, FAQ, pricing and comparisons comes from `content/availability.json`.
Bluesky, Mastodon and Telegram are available; X, Threads, LinkedIn and
Instagram/Facebook await platform approval without a date. Sign-in remains gated.

The shell warns during the last 72 hours of a trial, shows browser-local date,
time and timezone, and shows held-post counts after expiry. Billing names the
plan price, effective trial status, Stripe upcoming-invoice estimate when a
payment method exists, invoice history and cancellation consequences. Stripe
lookup failures are shown as unavailable, never as a fabricated zero charge.

Unstarted scheduled/approved posts support Reschedule. `PATCH /api/v1/posts/{id}`
accepts only a future ISO `scheduled_at` with timezone and requires `posts:write`.
It shifts queued targets atomically and preserves approval. Editing content
recreates unstarted targets and resets approved content to pending approval;
started targets cannot be edited. Post and target locks coordinate with the worker.

Images are uploaded first; URL entry is an expandable alternative. Descriptions
are stored in `posts.media_alt` keyed by image URL and forwarded to Bluesky and
Mastodon. The API accepts/returns `media_alt`; other adapters ignore it. Preview
tabs show network limits and approximate truncation without altering saved text.

Notifications in the shell are shared acknowledgements for the workspace (up to
50 unread displayed). Owners configure Slack, Discord or Mattermost incoming
webhooks at `/app/settings/notifications`. URLs and signing keys are encrypted;
settings do not reveal them again. Alerts use the existing outbox, signatures,
SSRF-safe fetch and five-attempt retry policy; alert deliveries continue when
subscription access expires. They carry event notices and post links, not post
bodies or client comments. Test messages are limited to one per destination per
minute. API endpoints remain Agency-gated and separately listed. No email or
Telegram notification delivery is included.

DPA acceptance is owner-only, idempotent per workspace/version and stores the
user, server time and exact document SHA-256. Preserve prior contract versions
when revising the DPA. Print / Save as PDF is available through the browser.

Run `npx tsx scripts/verify-c6.ts` for service/route/outbox checks; add
`C6_HTTP_URL=http://localhost:3997` and `PLAYWRIGHT_MODULE` for 390/1280 browser
checks against a running build. Test-only loopback delivery is disabled in
production. The verifier uses synthetic sessions and a local alert receiver,
removes its database fixtures, and never performs a real provider login or post.

### Bulk planner and CSV import

`/app/posts/bulk` plans up to 200 posts in a table, with brand timezone dates,
per-channel counters, one image upload/URL per row, approval, drafts, row results
and even distribution across days and time slots. Calendar and Posts link to it.
Bulk is available on every plan; publishing, approval, brand and media quotas
retain their existing rules. CSV preview accepts UTF-8/BOM and comma/semicolon
files with `date,time,text,channels,image_url,requires_approval` (512 KB maximum).
Channel names/providers use `|`; a provider selects all matching brand channels.

`POST /api/v1/posts/bulk` accepts 1–200 normal post inputs (one image each), uses
`savePost` per row, and returns HTTP 200 with ordered `{data:[{index,status,id,
post_status}|{index,status,error}]}` results. Invalid rows do not roll back other
rows. Post text is limited to 10,000 Unicode grapheme characters independent of
channel limits; over-limit validation errors identify the `body` field. An
optional Idempotency-Key serializes concurrent requests and persists
the complete response for 24 hours; changed payloads return 409. The existing
Agency API access and posts:write scope apply. No schema migration is needed.
Run `npx tsx scripts/verify-bulk.ts`; set BULK_BROWSER_URL to a local built app
for Playwright checks and screenshots in the external verification evidence directory.


## Runtime safeguards (cycle 7)

Required at startup: DATABASE_URL, AUTH_SECRET, CRON_SECRET and a valid
APP_ENCRYPTION_KEY or APP_ENCRYPTION_KEYS. At least one canonical origin is required;
APP_URL, AUTH_URL and NEXT_PUBLIC_APP_URL must agree when set. Production origins
must use HTTPS (literal local test hosts may use HTTP). Optional Google/SMTP/Stripe
features remain gated by their own configuration; health is not a provider-login test.
AUTH_TRUST_HOST=true is valid only behind a proxy that overwrites Host/forwarded
headers. APPROVAL_TRUST_PROXY=true additionally trusts overwritten X-Real-IP for
anonymous limits. Without it, requests share the conservative untrusted-peer bucket.
Never expose the app port around that proxy.

`/healthz` keeps `{ok,db,version}` and adds `migrations:{applied,latest}` and
`worker:{lastTickAt,ageSeconds,expected}`. It uses the shared five-connection client,
a two-second response deadline and 60 requests/minute/IP. Readiness is 503 on missing
migrations or a worker without a successful tick for more than five minutes. The
initial five-minute window starts at process startup. WORKER_ENABLED=false explicitly
disables the in-process worker and its stale-tick requirement for web-only replicas.
Coolify's existing GET /healthz healthcheck remains valid.

Central `lib/http/body.ts` caps raw Stripe bodies at 512 KiB, ordinary JSON/forms at
64 KiB, bulk at 2 MiB and upload bytes at the existing 5 MiB plus encoding overhead.
Content-Length is checked before reading and the real stream is capped with a
10-second deadline. Server Actions pass the same pre-parser proxy checks (bulk path
2 MiB; others 64 KiB); Next's additional action limit is 2 MiB. Anonymous budgets in
PostgreSQL: /r/* 60/min, /m/* 300/min, /join/* 30/min and /healthz 60/min per IP.
Session actions share 120/min/user, uploads 30/min/user/workspace, billing 5/min/user,
webhook tests 10/hour/workspace, API calls 60/min/key. A workspace may have at most
20 active API keys; revoke a key before creating another. Concurrent creates lock
the workspace. Revoked key history is retained until creator/workspace deletion.

Per publishing tick at most 10 due targets are claimed, with at most five channel
health checks. Health claims and fenced results use short transactions; provider I/O
runs outside them. Webhook dispatch has a 10-second budget, at most 10 claims and four
concurrent requests across its small batches. These are
processing bounds, not an unlimited-throughput guarantee or a total stored-post
quota. Admission is controlled by the request budgets and plan/storage limits.

## Key rotation

All new ciphertext uses `v1:<keyId>:<iv>:<ct>:<tag>` (AES-256-GCM, authenticated
version/key ID). Set `APP_ENCRYPTION_KEYS=id1:base64,id2:base64`; the first entry is
the write key, all entries are read keys. The existing APP_ENCRYPTION_KEY remains
readable as k0, including legacy `iv.tag.ct` records. Without a ring, k0 writes v1.
Never reuse an ID for a different key. Keep keys in the secret vault separately
from ciphertext backups.

1. Take a predeploy dump and securely preserve the existing keyring.
2. Deploy the new first/write key followed by all previous read keys, keeping the
   legacy APP_ENCRYPTION_KEY until legacy records have been migrated.
3. Export the same runtime environment privately and run `npx tsx scripts/reencrypt.ts`
   from a dependency-installed checkout (tsx is a development runner, not included
   in the runtime image). Channels, API/alert webhook secrets and OAuth verifiers
   are rewritten in one transaction. The command logs counts only, is idempotent,
   serializes rotations and rolls back completely if any ciphertext is unreadable.
4. Verify channels/webhooks and retain old keys for the entire backup rollback
   window. Remove old read keys only when neither live records nor retained backups
   need them. On failure retain the full ring, investigate privately and retry.
   Never remove an old key merely because a new image is healthy.

## Data lifecycle and release operations

Owners can export or delete a workspace and transfer ownership at
/app/settings/workspace. Account deletion is at /app/settings/account and blocks
last owners. Posts/media survive account deletion with anonymous creator IDs;
workspace deletion cancels Stripe without proration, expires open checkouts and
cascades workspace data. See [offboarding runbook](docs/offboarding.md) and
[migration/rollback contract](docs/migrations.md). Identity-provider access, refresh
and ID tokens are discarded by the adapter; migration 0014 clears existing tokens.

Daily guarded retention: unused media 30 days, webhook deliveries 30 days,
notifications 90 days, rate windows expired for one day, invites consumed/revoked/
expired for 30 days, OAuth states expired for one day, offboarding events 90 days.
Post/approval history lasts until post/workspace deletion. Media/deleted-workspace
markers keep random IDs and timestamps for revocation. Public media is a capability:
anyone with its URL can fetch it, and network/previous cache copies may outlive deletion.

Observed 2026-09-09 in the Postial Coolify container: Docker json-file logs,
max-size=10m and max-file=3 (approximately 30 MB/container, not 30 days). Proxy and
build-log time retention were not verified. The existing host backup job keeps two
successful dumps per database; predeploy dumps are manually retained through release
acceptance. No verified offsite copy of the host Postial DB is claimed. Restore
procedures and evidence live in the venture ops/ directory.

Dependency decision rechecked 2026-09-09: Nodemailer 10.0.1 is latest; next-auth beta.32
and @auth/core 0.41.3 permit only ^7.0.7 or ^8.0.5. No supported override reaches the
raw/content-resolver fixes (9.x+). Keep 8.0.11 without force; do not accept arbitrary
mailer options. Auth.js's fixed sendVerificationRequest supplies only to/from/subject/
text/html, never raw or resolveContent. A bounded strict normalizeIdentifier runs
before address parsing, and verify-c7 sends the actual fixed message through a mocked
transport, without a login or email delivery. Audit risks remain in that dependency
chain until its peer range supports a patched version. Sources: [Auth.js peer range](https://github.com/nextauthjs/next-auth/blob/main/packages/next-auth/package.json),
[Nodemailer advisory](https://github.com/advisories/GHSA-p6gq-j5cr-w38f).
Zod is an explicit production dependency.

Run `npx tsx scripts/verify-c7.ts`; optional C7_HTTP_URL adds built HTTP checks.
The verifier uses synthetic fixtures, a mocked mail transport and mocked Stripe
cancellation. Re-encryption is checked inside a rolled-back transaction so existing
credentials never become dependent on a test key.


### Cycle 8 performance and accessibility

Inter is bundled as Latin WOFF2 in weights 400/500/600/700 with `font-display: swap`.
Fonts load on demand; the marketing pages use 600 for emphasis and defer the
interactive demo until it approaches the viewport. Marketing links do not prefetch.
Regenerate the subsets from the retained, licensed source with
`scripts/subset-inter.py` in a temporary Python environment with `fonttools[woff]`.

Posts load 50 per page, preserving brand/status filters in pagination links.
Calendar date/view are URL parameters; SQL returns only the displayed 42-day
month grid or seven-day week using each brand's timezone. Overview counters are
SQL aggregates; next-up, attention and approval previews have bounded sizes.
Mobile keyboard targets reserve space for bottom navigation; bulk rows and CSV
previews stack into cards below 768px. Public approvals render saved image alt text.

`C8_HTTP_URL=http://localhost:4098 PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs
npx tsx scripts/verify-c8.ts` checks pagination, timezone boundaries, weekly counters,
keyboard focus, mobile cards, alt escaping/fallback and axe with temporary DB fixtures.
It needs the local test database and a built app with `WORKER_ENABLED=false`.
Playwright and axe-core are installed development dependencies; `AXE_PATH` can override the axe bundle.


## Release verification and repository hygiene

See [architecture](docs/architecture.md), [incident runbooks](docs/runbooks.md) and
[changelog](CHANGELOG.md). The complete commented runtime/test configuration is
[.env.example](.env.example); it also documents canonical-origin equality, optional
provider pairs, proxy trust, worker control and historical verifier URL aliases.
There is no global credential environment variable for individual social channels,
no separate media bucket, and no Stripe publishable key requirement.

```sh
npm ci
npm run lint
npx tsc --noEmit
npm run build                 # no DATABASE_URL or secrets needed
# Export DATABASE_URL for a migrated disposable test DB; never production.
npm run db:migrate
npm run verify:all            # all DB/unit/harness verifiers, no existing app server
npm run verify:http           # starts built standalone on a free local port; always stops it
```

`verify:all` includes 13 verifier entry points (including signed-webhook, OAuth
and API self-hosted mock harnesses). `verify:http` includes 20 HTTP/browser entry
points, with the optional HTTP branches enabled. Verifiers execute sequentially:
worker/retention fixtures can touch shared maintenance state, so use a disposable
migrated database and do not run other verification against the same DB concurrently.
They create synthetic database sessions; no provider login or payment is performed.
The C8 verifier is included in `verify:http` because its database fixtures are
validated through the managed standalone browser session; the DB suite remains
server-independent.
The runner strips provider/SMTP credentials, uses mocked Stripe values, random auth
and cron secrets and disables the background worker. Existing encryption read keys
are preserved when supplied. `verify-c7` requires the legacy read key for its explicit
legacy-ciphertext regression; supply `APP_ENCRYPTION_KEY` to that suite.

Install Chrome or set `CHROME_PATH` to an existing Chromium executable. Playwright,
axe-core and tsx are locked development dependencies. An individual HTTP verifier
uses `VERIFY_BASE_URL` first, then its old variable/default. The managed HTTP suite
always selects its own free port and configures all canonical origins accordingly;
no pre-existing server is reused. It stops its child on success, failure or signals,
waits for database/migration readiness and imposes a five-minute per-verifier timeout.
Evidence defaults to `../work/verification` outside the checkout, configurable via
`VERIFY_EVIDENCE_DIR`; standalone logs are created with mode 0600. Never publish raw
fixture logs or screenshots without checking for personal data.

GitHub Actions runs install, lint, TypeScript and a secret-free build on every push
and PR with Node 22 and read-only repository permissions. `npm audit --audit-level=high`
is deliberately non-blocking; its full result appears in the job summary. Database
and browser verification run locally, not against production or CI secrets.

Historical `work/` evidence was committed in earlier cycles (confirmed with
`git log --all -- work/`). It is now removed from the index and ignored; existing
files were merged into `/home/flori/ventures2/socialmint/work/` without overwrites
(`-repo` suffix on collisions). Git history was not rewritten. Older fixer scripts
remain because they assert security, tenancy, approval and browser regressions.
The obsolete second no-DB server check was removed: configuration now fails before
startup, and `verify-c7` tests that contract. No product scheduler jobs were changed.

## Operations reference

Deploy through Sandy to https://postial.co using the checked-in
Dockerfile, runtime secrets and port 3000. Take a predeploy dump, retain the prior
image digest/migration tip, serialize startup migrations and verify `/healthz` after
rollout. The build copies standalone static/public assets; startup migrations fail
closed. Follow [migration/rollback rules](docs/migrations.md), the Key rotation
section above, and [incident runbooks](docs/runbooks.md).

The venture sibling `../ops/` (absolute path
`/home/flori/ventures2/socialmint/ops/`) contains `RELEASE.md`, `predeploy-dump.sh`,
`BACKUP-STATUS.md` and `RESTORE.md`, plus monitor/restore evidence. These host-specific
files are intentionally outside this source repo. Database dumps include media
bytes; encryption read keys require separate protected backups. The current root
backup job runs at 03:00 UTC and retains two dumps per database. An offsite copy
and full-host disaster recovery are not verified. Do not infer them from a healthy
application or a successful isolated table-count restore.

## Script inventory

Run TypeScript scripts with `npx tsx scripts/<name>`, JavaScript with `node`, and
Python with `python3`. “Server” means an already-running app for individual use;
self-hosted local mock harnesses count as “No”. The managed HTTP suite supplies it.
DB means `DATABASE_URL` for a migrated disposable database. Browser scripts also
accept `PLAYWRIGHT_MODULE`, `CHROME_PATH` and `VERIFY_EVIDENCE_DIR`; HTTP scripts all
accept `VERIFY_BASE_URL`. Runtime auth/encryption/Stripe fixture configuration is
supplied automatically by the suite; direct execution must provide required values.

| Name | Purpose | Server | Env / prerequisites |
| --- | --- | --- | --- |
| `billing-mock.ts` | In-process Stripe SDK and route fixture helper | No | `STRIPE_PORTAL_CONFIG`, `STRIPE_PRICE_AGENCY`, `STRIPE_PRICE_STARTER` |
| `fixture-cleanup.ts` | Safe synthetic-user/workspace cleanup helper | No | `DB` |
| `generate-help-index.ts` | Regenerate bundled help search index | No | — |
| `migrate.mjs` | Apply checked-in ordered Drizzle migrations | No | `DB`, `DATABASE_URL` |
| `prepare-standalone.mjs` | Copy public/static/runtime migration files after build | No | .next build output |
| `reencrypt.ts` | Transactional versioned credential re-encryption | No | `DB` |
| `subset-inter.py` | Regenerate licensed Latin Inter WOFF2 subsets | No | fonttools[woff] |
| `test-runtime.ts` | Install AsyncLocalStorage for handler harnesses | No | — |
| `verify-api.ts` | API scopes, tenancy, idempotency, outbox and retries | Optional | `DB`, `API_HTTP_URL`, `APP_ENCRYPTION_KEY`, `AUTH_SECRET`, `AUTH_URL`, `NEXT_PUBLIC_APP_URL`, `WEBHOOK_ALLOW_LOOPBACK` |
| `verify-approvals.ts` | Capability approval, revocation, privacy and editing | Yes | `DB`, `APPROVAL_HTTP_URL`, `APPROVAL_SCREENSHOT` |
| `verify-appshell.ts` | Authenticated navigation, workspace shell and mobile states | Yes | `DB`, `APPSHELL_HTTP_URL` |
| `verify-billing.ts` | Mocked Checkout/Portal, limits, redirects and paid restart | Yes | `DB`, `BILLING_HTTP_URL` |
| `verify-bulk.ts` | Bulk/CSV validation, entitlement and idempotency regressions | Optional | `DB`, `BULK_BROWSER_URL` |
| `verify-c6.ts` | Editing, notifications, DPA, billing and alert delivery | Optional | `DB`, `AUTH_URL`, `C6_HTTP_URL`, `NEXT_PUBLIC_APP_URL`, `WEBHOOK_ALLOW_LOOPBACK` |
| `verify-c7.ts` | Startup, bounded requests, key rotation, retention and offboarding | Optional | `DB`, `APPROVAL_TRUST_PROXY`, `APP_ENCRYPTION_KEY`, `APP_ENCRYPTION_KEYS`, `C7_HTTP_URL`, `CRON_SECRET`, `WORKER_ENABLED` |
| `verify-c8.ts` | Pagination, timezone windows, keyboard focus and axe scans | Yes | `DB`, `AXE_PATH`, `C8_EVIDENCE`, `C8_HTTP_URL` |
| `verify-core-http.ts` | Protected product pages and internal tick authorization | Yes | `DB`, `CORE_HTTP_URL` |
| `verify-core.ts` | Encryption, scheduling, claims, fencing, retries and plan holds | Optional | `DB`, `CORE_HTTP_URL` |
| `verify-docs-browser.mjs` | Help search, links, mobile layout and navigation | Yes | `DOCS_HTTP_URL` |
| `verify-docs.ts` | Help index, safe markdown, links, sitemap and legal routes | Yes | `DOCS_HTTP_URL` |
| `verify-entitlements.ts` | Exact trial/subscription/grace boundary cases | No | — |
| `verify-fixer-browser.mjs` | Headers, responsive pages, checkout continuation and expired session | Yes | `DB`, `BROWSER_BASE_URL`, `DATABASE_URL` |
| `verify-fixer2-browser.ts` | Return paths, warning persistence, channel errors and expiry | Yes | `DB`, `FIXER2_EVIDENCE`, `FIXER2_URL` |
| `verify-fixer3-browser.ts` | No-channel/Starter composer guards, provider counters and delivery-log layout | Yes | `DB`, `FIXER3_EVIDENCE`, `FIXER3_HTTP_URL` |
| `verify-fixer3-migration.ts` | Historical approval privacy migration on temporary tables | No | `DB` |
| `verify-http.mjs` | Public/auth redirects and health response shape | Yes | — |
| `verify-marketing-browser.mjs` | Interactive demo keyboard flow and responsive marketing | Yes | `MARKETING_TEST_URL` |
| `verify-marketing.mjs` | Public copy, schema, pricing and legal metadata | Yes | `MARKETING_TEST_URL` |
| `verify-media.ts` | Upload decoding, limits, tenancy, API, cache and SSRF regressions | Yes | `DB`, `MEDIA_ALLOW_LOOPBACK`, `MEDIA_HTTP_URL`, `NEXT_PUBLIC_APP_URL` |
| `verify-oauth.ts` | Local OAuth mocks, state/cookies, refresh locking and callback errors | No | `DB`, `APP_ENCRYPTION_KEY`, `APP_URL`, `AUTH_SECRET`, `AUTH_URL`, `NEXT_PUBLIC_APP_URL`, `THREADS_API_BASE_URL`, `THREADS_APP_ID`, `THREADS_APP_SECRET`, `X_API_BASE_URL`, `X_CLIENT_ID`, `X_CLIENT_SECRET` |
| `verify-pilot.ts` | Channel health, approval groups, duplication and retention | No | `DB` |
| `verify-publishers.ts` | Mock adapter errors, SSRF, deadlines and provider semantics | No | `X_CLIENT_ID`, `X_CLIENT_SECRET` |
| `verify-retention.ts` | Media retention fixture and maintenance state cleanup | No | `DB` |
| `verify-suite.mjs` | Managed sequential DB or standalone HTTP suite | Managed | `DATABASE_URL` |
| `verify-team.ts` | Invites, roles, expiry, revocation and workspace switching | Yes | `DB`, `TEAM_HTTP_URL` |
| `verify-waitlist.ts` | Normalization, persistence, shared limits and spoof resistance | Yes | `DB`, `DATABASE_URL`, `WAITLIST_BASE_URL` |
| `verify-webhook.ts` | Signed raw webhook, deduplication and reconciliation harness | No | `DB` |
| `verify-workspace.ts` | Concurrent onboarding, owner membership and sessions | No | `DB` |
