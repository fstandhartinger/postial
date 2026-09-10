# Flaky approval verification

## GELIEFERT

- Deterministische Navigation-Synchronisierung in `scripts/verify-approval-e2e.ts`, `scripts/verify-approvals.ts` und `scripts/verify-appshell.ts`: Redirect-basierte Composer-Aktionen werden mit `waitForURL(..., { waitUntil: "networkidle" })` abgeschlossen, bevor der gerenderte Zustand geprüft wird.
- Ursache belegt: `coreAction` ruft in `app/app/actions.ts:174-176` `savePost` auf, setzt danach das Ziel auf `/app/posts/:id`, invalidiert in `app/app/actions.ts:191` den App-Layout-Cache und führt in `app/app/actions.ts:192` den Redirect aus. Die flakey Assertion stand in `scripts/verify-approval-e2e.ts:46` unmittelbar hinter einer URL-Wartebedingung; die URL konnte bereits feststehen, während der neue RSC-Inhalt mit `Post saved for client approval` noch nicht abgeschlossen gerendert war.
- Keine Wiederholungsschleifen, kein `waitForTimeout`, keine pauschal verlängerten Wartezeiten.

## VERIFIZIERT WIE

- `scripts/verify-approval-e2e.ts` seriell, fünf unabhängige Läufe mit je eigener isolierter Wegwerf-Datenbank und eigenem HTTP-Server:
  - Lauf 1: PASS
  - Lauf 2: PASS
  - Lauf 3: PASS
  - Lauf 4: PASS
  - Lauf 5: PASS
- `npx tsc --noEmit`: rc=0
- `npm run build`: erfolgreich
- `npm run verify:all`: PASS
- `npm run verify:http`: PASS; browserlastige Prüfer liefen seriell, einschließlich Approval E2E PASS.
- Weitere Prüfung der Browser-Checker: Redirect-Composer-Flows in `verify-approvals.ts` und `verify-appshell.ts` ebenfalls auf abgeschlossene Navigation synchronisiert. Zustandsbasierte `useActionState`-Prüfer warten bereits auf den Action-State und wurden nicht künstlich verzögert.

## OFFEN

- Nichts im beauftragten Scope. Kein Push und kein Deploy ausgeführt.
