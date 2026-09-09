# Architecture

Postial 0.2.0 is a Next.js 16 App Router application deployed as a Node.js
standalone process. Server Components read scoped data; Server Actions and Route
Handlers validate mutations. Auth.js uses PostgreSQL database sessions. The public
site, help centre and API documentation can be built without a database or secrets.
Runtime configuration is validated before serving traffic.

## Components

| Component | Responsibility / implementation |
| --- | --- |
| Next.js app | `app/`: marketing, help, workspace UI, approval capabilities, REST v1 and internal routes; `auth.ts`: optional Google and email sign-in |
| In-process worker | `instrumentation.ts`, `lib/publishing/`: starts a 30-second timer in each enabled Node process; also callable through secret-authenticated `/api/internal/tick` |
| PostgreSQL | `db/`, `drizzle/`: tenants, sessions, channels, posts, claims, entitlements, idempotency, limits and outboxes; Drizzle queries, shared five-connection client, prepared statements disabled for PgBouncer |
| Stripe | `lib/stripe*`, billing/checkout services and `/api/stripe/*`: Checkout, Portal and signed webhook reconciliation; provider events, not success redirects, establish access |
| Provider adapters | `lib/publishers/`: Bluesky, Mastodon, Telegram, X and Threads; normalized validation/errors, deadlines, refresh locking and provider-specific idempotency. X/Threads require approved app credentials; UI availability is configuration-dependent |
| Webhook outbox | `lib/api/webhooks.ts`: transactionally recorded technical events, signed bounded dispatch, leases, retries and paused disabled endpoints. Approval names/comments are excluded |
| Notifications | In-app notifications and opt-in Slack/Discord/Mattermost alert webhooks; bounded dispatch and encrypted secrets |
| Media storage | `db/media-schema.ts`, `lib/media/`: normalized image bytes in PostgreSQL `bytea`, metadata, quotas, conditional GET and capability URLs under `/m/`; no separate object bucket or local upload volume |
| Entitlements | `lib/entitlements.ts`: shared access authority for UI, API and worker; dated trial/subscription checks, billing grace windows, brand/seat/API/approval/storage restrictions |

## Post flow

1. A workspace member creates a draft in the composer, bulk planner or scoped API.
   The server verifies role, brand/channel ownership, lengths, media, quotas and
   timezone/DST semantics. API idempotency prevents duplicate accepted submissions.
2. A scheduled post requires current entitlements. Approval-required content stays
   pending until its random capability link is approved. Editing approved content
   invalidates approval; date-only rescheduling preserves it.
3. The timer claims up to ten due targets with `FOR UPDATE SKIP LOCKED`. Claims and
   fenced attempt IDs commit before provider network calls. A 30-second heartbeat
   extends the lease; each publish has a 90-second deadline.
4. The adapter decrypts channel credentials and publishes. Results update only the
   matching attempt. Mastodon idempotency keys and Bluesky record keys remain stable;
   ambiguous Telegram outcomes require manual review. Expired credentials require
   reconnection; transient failures retry at 1/4/15/60 minutes with provider advice,
   up to five attempts. Ten-minute abandoned attempts are recovered within that budget.
5. Post status aggregates target results. The transaction records technical outbox
   events; independent dispatch delivers signed webhooks, and users see status,
   history and notifications. The worker holds jobs when entitlements lapse.

## Security and operational boundaries

Every tenant operation checks membership and role; API keys add hashed credentials,
scopes and shared database rate limits. Public approval/invite/media links are bearer
capabilities, with bounded anonymous requests and revocation/deletion semantics.
State-changing session requests validate origin. Proxy-derived IPs are trusted only
when explicitly configured behind an ingress that overwrites those headers.

Channel and webhook secrets use versioned AES-256-GCM authenticated encryption.
Old read keys must remain available for live rows and retained backups. Provider
URLs pass SSRF validation and DNS/address pinning; loopback test overrides are
ignored in production. Bodies, image decoding, network duration, worker batches and
webhook concurrency are bounded. Stripe signatures use raw bounded request bodies;
transactions and revisions serialize billing updates and deduplicate events.
Security headers apply centrally. Identity-provider access/refresh/ID tokens are
not retained. Workspace deletion cascades tenant data and keeps minimal revocation
markers; retention jobs prune transient data. See [runbooks](runbooks.md),
[migrations](migrations.md) and [offboarding](offboarding.md).

This is not a separate durable queue service: PostgreSQL persists work, while live
Node processes execute it. `/healthz` checks DB, migrations and worker progress;
web-only replicas can set `WORKER_ENABLED=false`. A healthy endpoint does not prove
provider logins, mail delivery or a complete Stripe payment lifecycle. Dependency
advisories and the current backup/offsite limitations are recorded in README.
