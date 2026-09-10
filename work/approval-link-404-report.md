# Approval-Link-404

## Befund

Hypothese (a) ist im reproduzierten Formularweg nicht die Ursache: Nach der Nachbesserung enthielt die persistierte `posts`-Zeile in der isolierten Verifikationsdatenbank:

- `status = pending_approval`
- `requires_approval = true`
- `approval_token = derselbe 43-stellige Token wie vor der Bearbeitung`

Hypothese (b) ist ebenfalls widerlegt. Der Browserweg läuft in `app/app/actions.ts:173-174` über `savePost`; der Resubmission-Zweig in `lib/api/post-service.ts:135-143` wird erreicht und schreibt `requiresApproval` sowie den unveränderten Token in `lib/api/post-service.ts:146-165`. Die öffentliche Abfrage in `lib/approvals.ts:24-30` liefert mit diesen Daten 200.

Der verbleibende 404 war ein Fehler im E2E-Prüfpfad: `fresh` ist bereits die vollständige URL (`${base}/r/${token}`), wurde danach aber nochmals als `${base}/r/${fresh}` verwendet. Zusätzlich erwartete der Test für den alten, absichtlich erhaltenen Token fälschlich 404.

## GELIEFERT

- E2E-Prüfung korrigiert: vollständigen `fresh`-Link direkt verwenden.
- Persistenzzusicherung für `requiresApproval = true` ergänzt.
- Bereits verschickter Token bleibt bei `changes_requested` → erneuter Vorlage erhalten.
- Keine Änderungen an Token-Erzeugung außerhalb dieses Pfads, Abrechnung, Auth oder Publisher.

## VERIFIZIERT WIE

- Isolierte PostgreSQL-Verifikationsdatenbank; keine Produktionsdatenbank.
- `npx tsc --noEmit` — PASS
- `npm run build` — PASS
- `npm run verify:all` — PASS
- `npm run verify:http` — PASS, einschließlich vollständigem `scripts/verify-approval-e2e.ts`.
- Browserlastige Prüfungen seriell ausgeführt.

## OFFEN

- Kein Push, kein Deploy.
- Keine offenen funktionalen Punkte.
