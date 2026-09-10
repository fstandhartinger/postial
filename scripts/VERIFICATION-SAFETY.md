# Verification safety

`verify:all` and `verify:http` require **VERIFY_ADMIN_DATABASE_URL**, pointing at a dedicated disposable PostgreSQL server with database and administrator role `postial_verify_admin`. They never fall back to DATABASE_URL, rewrite a port, or create a schema in an application database. Do not supply production credentials.

On that disposable server only, revoke PUBLIC CONNECT on bootstrap databases (`postgres`, `template1`, `postial_verify_admin`). The runner creates a unique database and matching NOINHERIT/NOSUPERUSER/NOCREATEDB/NOCREATEROLE/NOBYPASSRLS login. The login owns only its fixture DB; actual session validation rejects membership, access to any other connectable database, target/owner mismatch, and a non-public effective search path. VERIFY_ISOLATED_SCHEMA and VERIFY_ALLOW_SHARED_DB are **not** authorization for fixtures. No production role or bypass is required.

The suite installs signal handlers before setup, cancels and waits for migration/test/server children, and removes the exact owned database and role after setup failure, SIGINT/SIGTERM, test failure or success. Cleanup errors remain failures. SIGKILL cannot run cleanup; dispose of the dedicated server after a hard-killed run. No shared-server sweeps are needed.

Commands (with explicit isolated URLs set by the operator):

```
TEST_ADMIN_URL="$VERIFY_ADMIN_DATABASE_URL" node --test --test-reporter=tap scripts/isolation.test.mjs
node --import tsx --test --test-reporter=tap scripts/availability.test.ts
npm run verify:all
npm run build
npm run verify:http
```

`isolation.test.mjs` requires an otherwise idle dedicated server. Its setup/signal audits substitute only an audit migration in a temporary working directory; application code is never replaced. Existing verifier source-inspection assertions are audit coverage, distinct from rendered/runtime and real-PG behavior. Provider calls in fixtures are mocked; these tests prove neither actual payment nor social-network delivery.
