# Bulk planning verification — 2026-09-09

Implemented `/app/posts/bulk`, CSV preview/import, daily counts, even time-slot
allocation, one-image upload, row actions/results and Calendar/Posts entry links.
`POST /api/v1/posts/bulk` reuses the composer save service and existing API access,
scope, rate limit and idempotency storage. Bulk adds no plan gate or migration.
With an Idempotency-Key, per-row savepoints and the response commit together;
validation/database errors are isolated to their row. Without a key and in the
UI, each row has its own transaction. Successful UI rows are excluded from retry.

## Checks

- `npm run lint`, `npx tsc --noEmit`, `npm run build`.
- `scripts/verify-bulk.ts`: five posts plus targets; over-limit partial failure;
  UTF-8 BOM/semicolon/escaped multiline CSV; unknown channels/approval validation;
  201 rows rejected with 422; date distribution in Europe/Berlin in winter/summer,
  daylight-saving gaps/folds and insufficient slot rejection; concurrent keyed
  API replay, changed-input and cross-endpoint conflicts; private media rejection,
  single-image limit, foreign channel, Starter publishing and expired-plan drafts.
- Playwright with `BULK_BROWSER_URL=http://localhost:4017`: editor and CSV preview
  at 390/1280; no page overflow or runtime errors; real server-action save of one
  valid and one invalid CSV row with one resulting post link. Test sessions are
  synthetic database fixtures; no login or external publishing is automated.
- Existing workspace, entitlements, publishers, OAuth, core, API, cycle 6,
  retention and fixer3-migration verifiers; built HTTP/browser approvals, team,
  media and cycle 6 suites.
- Redocly OpenAPI lint; changed-file secret scan.

Historical screenshots were moved to the venture sibling `../work/bulk-evidence/`.
New runs use `VERIFY_EVIDENCE_DIR/bulk-evidence/` (or `../work/bulk-evidence/`
for direct execution), outside the repository.

CSV/image preview does not fetch external images. The normal save service checks
public HTTPS/DNS and uploaded-asset ownership before saving, as in the composer.
Provider delivery and billing purchases are outside these synthetic checks.
