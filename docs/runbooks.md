# Operational runbooks

Use the deployed release's environment privately. Never copy tokens, session
cookies, raw webhook bodies or database URLs into incident logs. Record timestamps,
release SHA, sanitized error codes and affected counts. The host-specific scripts
and verified backup evidence live outside this repository in
`/home/flori/ventures2/socialmint/ops/` (the sibling `../ops/` from the main checkout).
Start with its `README.md`, `RELEASE.md`, `BACKUP-STATUS.md` and `RESTORE.md`.

## Worker stops progressing

1. Read `/healthz`: database, migration tip, `worker.expected`, `lastTickAt` and
   age. More than five minutes without a successful enabled-worker tick is unready;
   a web-only replica intentionally reports `expected=false`.
2. Check sanitized application logs, database connectivity/pool exhaustion and
   migration completion. Confirm at least one intended publishing replica has
   `WORKER_ENABLED=true`; inspect pending/publishing counts and expired leases.
   An expired plan or inactive brand legitimately holds targets.
3. If the process is healthy, call `POST /api/internal/tick` from an operational
   client using `x-cron-secret` supplied privately. Do not place that secret in
   shell history or logs. It uses the same claims and fencing as the timer.
4. If the timer is stuck, coordinate a restart through the existing Sandy service
   controls. Do not manually clear attempt IDs or resend ambiguous publishes.
   Ten-minute abandoned attempts recover within the five-attempt budget; Telegram
   unknown outcomes require checking the remote channel before manual retry.
5. Verify repeated fresh health timestamps and decreasing eligible queue counts.
   Reconcile all targets of partially published posts; do not retry published ones.

## Many channels report token_expired

1. Group failures by provider and time using sanitized codes. Check whether only
   one provider, all channels after a rollout, or only one key version is affected.
2. Check that the complete encryption read keyring and OAuth client configuration
   survived deployment. A missing old key is a configuration incident: restore the
   read key from the vault, keeping the current write key. Do not replace ciphertext
   or relabel key IDs. See README's key-rotation procedure.
3. Check provider status, OAuth app permissions/approval and refresh errors using
   official provider tools. Avoid retry storms; honor Retry-After and shared locks.
4. If credentials were actually revoked/expired, affected owners reconnect each
   channel through the product flow. Operators do not automate user logins.
5. Verify connection health, then review held/failed posts and retry only eligible
   unpublished targets. Record recovery counts without including credentials.

## Stripe webhook errors

1. Check Stripe delivery status and sanitized route error codes. Confirm the
   endpoint is `/api/stripe/webhook` on the canonical HTTPS origin and that the
   signing secret belongs to that endpoint and the correct test/live environment.
2. Signature 400: ensure the proxy preserves the raw body and signature header;
   do not disable signature verification. Body-limit 413: inspect event size and
   proxy configuration. 5xx: check DB/migrations, Stripe connectivity and runtime
   key/price configuration. Unknown event types intentionally return 200.
3. After repairing the cause, redeliver failed events from Stripe's authorized
   operational tools. Event IDs deduplicate; reconciliation retrieves current
   subscription state and serializes updates. Do not insert a subscription or
   grant access based only on a Checkout return URL.
4. Verify the affected workspace's subscription dates/status, billing state and
   entitlements. Check cancellation/retired-subscription handling before reopening
   a contract. Local mocked verifiers do not replace a real sandbox acceptance test.

## Restore / incompatible rollback

1. Coordinate a write freeze and retain the current image digest, migration tip,
   incident dump and encryption read keys. Follow `ops/RELEASE.md` and
   [the migration contract](migrations.md); image rollback does not undo schema.
2. Select a verified custom-format dump, check `pg_restore --list`, then restore
   into a **new** empty database using `--exit-on-error --single-transaction`.
   Follow the exact role/ownership instructions in `ops/RESTORE.md`. Never overwrite
   the only live copy. Keep the old DB through acceptance.
3. Pair the database with a compatible application image and all required read
   keys. Run migrations only for the chosen release. Start isolated with worker
   disabled and external delivery credentials absent; verify counts, tenant
   boundaries, representative posts and media, `/healthz` and application reads.
4. Reconcile post-snapshot writes and remote publishes, Stripe's current state,
   erasures and revocations before exposing traffic. Do not blindly replay an old
   queue: a backup cannot tell whether an external provider already accepted a post.
5. Switch the connection/PgBouncer mapping and image in a controlled window, restore
   intended worker operation, verify fresh ticks and functional access, and retain
   evidence. Current host policy keeps only two DB dumps; offsite recovery is not
   verified. The host monitor cannot detect its own complete host/network failure.
