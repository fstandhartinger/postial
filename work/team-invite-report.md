# Team-invite QA

| Fall | erwartet | tatsaechlich | Bewertung | Korrektur |
|---|---|---|---|---|
| Agency owner invites new person; sign-in/join | New person joins correct workspace as invited role | Browser journey joins correct workspace as editor | PASS | Regression kept in `verify-team.ts` |
| Existing member / same invite twice | Rejected without duplicate membership | Rejected; invite becomes single-use | PASS | Existing guards verified |
| Expired / revoked invite | Rejected | Expired/revoked messages and rejection | PASS | Existing guards verified |
| Invite accepted by another address | Must not join | Rejected with different-email error | PASS | Store normalized `invitedEmail`; compare at acceptance |
| Starter / Agency seat limit | Starter remains one seat; Agency five seats | Seat rejection and Agency five-seat behavior pass | PASS | Existing entitlement guard verified |
| Editor disconnects channels, billing, removes members, deletes workspace | Forbidden | 403/owner-only UI and action guards | PASS | Existing guards verified |
| Transfer ownership, remove member, last owner/account | Safe transfer/removal; last owner protected; shared content retained | Passed C7/offboarding checks | PASS | Existing offboarding behavior verified |

## GELIEFERT

- Invitations require a valid target email in the team UI.
- Invite records bind the token to the normalized target email.
- Acceptance rejects a different signed-in email before membership creation.
- Regression coverage added for wrong-address acceptance and updated fixtures/migration.

## VERIFIZIERT WIE

- Isolated DB only via `scripts/verify-suite.mjs`; no shared DB flag, production DB, real mail, login automation, push, or deploy.
- `npx tsc --noEmit`: rc=0.
- `npm run build`: successful.
- `npm run verify:all`: PASS.
- `npm run verify:http`: PASS, including browser team flow at 390/1280px.

## OFFEN

- No material QA findings remain. Mail delivery itself remains fixture-only per scope.
