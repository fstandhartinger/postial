# Funnel client classification

## GELIEFERT

- Migration `0020_funnel_client_class.sql` adds `funnel_events.client_class` with the allowed values `browser`, `automated`, and `unknown`; existing rows receive `unknown`.
- `recordPublicView` classifies only the request User-Agent header. The header is never persisted or logged; missing headers are `automated`.
- Admin funnel totals are separated into browser (People), automated, and unknown classes.
- Added `scripts/verify-funnel-client-class.ts` to the database verification suite. Updated the migration-health verifier from 0019 to the new latest migration 0020.

## VERIFIZIERT WIE

- Supervisor line: `run-verification: verifying /tmp/postial-funnel at e1b0766`
- Final `work/acceptance.json`: `ok: true`, `clean: true`, `commit: e1b0766816cea6058fd2565dd785f4b4acc2ae1d`, `directory: /tmp/postial-funnel`.
- Step return values: `tsc --noEmit=0`, `next build=0`, `verify:all=0`, `verify:http=0`.
- The dedicated verifier passed browser and automated User-Agent cases, missing-header behavior, stored-record absence of the synthetic User-Agent marker, and separated admin class totals.
- No production database, deploy, push, or secret output was used.

## OFFEN

- User-Agent classification is intentionally heuristic; unrecognized non-empty headers are classified as `browser` and can be reviewed if traffic evidence later warrants new patterns.
