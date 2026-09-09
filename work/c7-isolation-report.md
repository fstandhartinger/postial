# C7 fixture isolation report

Date: 2026-09-09

## Delivered

- `scripts/isolated-db.mjs` creates a per-run `postial_verify_<timestamp>_<random>` database on direct PostgreSQL port 5432 when `CREATEDB` is available. On this environment `socialmint_app` does not have `CREATEDB`, so the verified fallback creates a `verify_<timestamp>_<random>` schema with an isolated `search_path`.
- `scripts/verify-suite.mjs` migrates the isolated target, passes only that target to verifier children, and removes it in `finally`, including SIGINT/SIGTERM cleanup.
- Direct fixture verifiers refuse `dbname=socialmint` unless `VERIFY_ALLOW_SHARED_DB=1`; suite children are explicitly marked as isolated.
- C7 fixtures now use `@fixture.postial.invalid` and `fixture:C7`; its existing cleanup remains in `finally`.
- `scripts/fixture-sweep.ts` supports `--dry-run` (default) and `--apply`, including legacy `@example.invalid`, `C7 fixture`, and `sub_fixture_*` markers. No cron entry was created.
- README and `fixture-sweep` npm script document the workflow.

## Verification

- `npm run lint`: passed (after cleanup of two warnings).
- `npx tsc --noEmit`: passed.
- `npm run build`: passed.
- `npm run verify:all`: passed completely against an isolated schema; the temporary schema was removed.
- Production sweep with explicit `VERIFY_ALLOW_SHARED_DB=1`: dry-run reported zero marked workspaces, subscriptions, and users. No production fixture rows were changed.
- Direct PostgreSQL post-check: zero `postial_verify_*` databases and zero `verify_*` schemas after cleanup.
- `npm run verify:http`: isolation/cleanup worked, but the existing suite reported five unrelated baseline failures: stale docs index, approval assertion, C6 marketing copy assertion, C7 bulk-action assertion, and fixer2 browser assertion. The remaining HTTP verifiers passed, including C8 and fixture cleanup.

## Open

- The five pre-existing HTTP harness failures above should be repaired separately; they are not caused by the DB isolation changes.
- `socialmint_app` should receive `CREATEDB` only if database-per-run isolation is preferred over the currently verified schema fallback.
