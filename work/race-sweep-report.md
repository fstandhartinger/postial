# Race sweep

## Inventur und Änderungen

| Datei:Zeile | Muster | Wettrennen? | Änderung |
|---|---|---:|---|
| `scripts/verify-activation-checklist.ts:39` | Link zur Brand-Erstellung, danach neuer Screen | Ja | `waitForURL` vor Klick in `Promise.all` |
| `scripts/verify-activation-checklist.ts:42` | Create-brand-Formular, danach Brand-URL | Ja | `waitForURL` vor Klick in `Promise.all` |
| `scripts/verify-appshell.ts:73` | Create-brand-Link, danach Brand-Seite | Ja | `waitForURL` vor Klick in `Promise.all` |
| `scripts/verify-appshell.ts:75` | Create-brand-Formular, danach Brand-URL | Ja | `waitForURL` vor Klick in `Promise.all` |
| `scripts/verify-appshell.ts:89` | Connect-channel-Formular, danach Fehlerzustand | Ja | POST-Response vor Klick in `Promise.all` |
| `scripts/verify-appshell.ts:127` | Save-draft-Formular, danach Post-URL | Ja | `waitForURL` vor Klick in `Promise.all` |
| `scripts/verify-appshell.ts:128` | Edit-post-Link, danach Edit-Seite | Ja | `waitForURL` vor Klick in `Promise.all` |
| `scripts/verify-appshell.ts:166` | Schedule-Formular, danach Post-URL | Ja | `waitForURL` vor Klick in `Promise.all` |
| `scripts/verify-appshell.ts:260` | Approval-Schedule-Formular, danach Post-URL | Ja | `waitForURL` vor Klick in `Promise.all` |
| `scripts/verify-c6.ts:129` | Save-draft-Formular, danach Post-URL | Ja | `waitForURL` vor Klick in `Promise.all` |
| `scripts/verify-c6.ts:135` | Accept-DPA-Serveraktion, danach Bestätigung | Ja | POST-Response vor Klick in `Promise.all` |
| `scripts/verify-c8.ts:56` | Next-page-Link, danach `page=2` | Ja | `waitForURL` vor Klick in `Promise.all` |
| `scripts/verify-c8.ts:63` | Next-period-Aktion, danach neues Datum | Ja | `waitForURL` vor Klick in `Promise.all` |
| `scripts/verify-first-run-browser.ts:34` | Login-Link, danach Login-Seite | Ja | `waitForURL` vor Klick in `Promise.all` |
| `scripts/verify-first-run-browser.ts:65` | Create-brand-Link, danach Brand-Seite | Ja | `waitForURL` vor Klick in `Promise.all` |
| `scripts/verify-first-run-browser.ts:69` | Create-brand-Formular, danach Brand-URL | Ja | `waitForURL` vor Klick in `Promise.all` |
| `scripts/verify-funnel-browser.ts:33` | Magic-link-Formular, danach Check-email-URL | Ja | `waitForURL` vor Klick in `Promise.all` |
| `scripts/verify-funnel-browser.ts:49` | Create-brand-Formular, danach Brand-URL | Ja | `waitForURL` vor Klick in `Promise.all` |
| `scripts/verify-funnel-browser.ts:54` | Connect-channel-Serveraktion, danach Zustand | Ja | POST-Response vor Klick in `Promise.all` |
| `scripts/verify-funnel-browser.ts:61` | Schedule-Formular, danach Post-URL/Funnel-Event | Ja | URL und POST-Response vor Klick in `Promise.all` |
| `scripts/verify-fixer2-browser.ts:68` | Connect-channel-Formular, danach Fehlerzustand | Ja | POST-Response vor Klick in `Promise.all` |
| `scripts/verify-fixer2-browser.ts:83` | Save-draft-Formular, danach Post-URL | Ja | `waitForURL` vor Klick in `Promise.all` |
| `scripts/verify-fixer2-browser.ts:90` | Retry-Serveraktion, danach Retry-Zustand | Ja | POST-Response vor Klick in `Promise.all` |
| `scripts/verify-approvals.ts:137` | Schedule-Formular, danach Post-URL | Ja | bestehendes Vorab-`waitForURL` beibehalten |
| `scripts/verify-approvals.ts:150` | Regenerate-link-Serveraktion, danach neuer Link | Ja | POST-Response vor Klick in `Promise.all` |
| `scripts/verify-approval-e2e.ts:42` | Public Request-changes-Formular, danach Bestätigung | Ja | Navigation vor Klick in `Promise.all` |
| `scripts/verify-approval-e2e.ts:46` | Edit-post-Link, danach Edit-Seite | Ja | `waitForURL` vor Klick in `Promise.all` |
| `scripts/verify-approval-e2e.ts:48` | Resubmit-Schedule-Formular, danach Post-URL | Ja | bestehendes Vorab-`waitForURL` beibehalten |
| `scripts/verify-approval-e2e.ts:56` | Public Approve-Formular, danach Bestätigung | Ja | Navigation vor Klick in `Promise.all` |
| `scripts/verify-login-browser.ts:102` | Enter im Login-Formular, danach Check-email-URL | Ja | `waitForURL` vor Enter in `Promise.all` |
| `scripts/verify-team.ts:48` | Invite-Link-Serveraktion, danach Link-Feld | Ja | POST-Response vor Klick in `Promise.all` |
| `scripts/verify-team.ts:56` | Join-Formular, danach App-URL | Ja | `waitForURL` vor Klick in `Promise.all` |
| `scripts/verify-team.ts:65` | Workspace-switch-Formular, danach App-URL | Ja | `waitForURL` vor Klick in `Promise.all` |
| `scripts/verify-c6.ts:125` | Notifications-Button, danach Popup | Nein | lokaler UI-State ohne Navigation/Serveraktion; unverändert |
| `scripts/verify-appshell.ts:143` | Add-image-Button, danach lokales Bild | Nein | lokaler UI-State; die Bildprüfung bleibt zustandsbasiert |
| `scripts/verify-fixer2-browser.ts:60` | Add-image-Button, danach lokales Bild | Nein | lokaler UI-State; unverändert |
| `scripts/verify-appshell.ts:263` | Copy-link-Button, danach Toast | Nein | Clipboard/UI-State; unverändert |

## Verifiziert wie

- `npx tsc --noEmit` — rc=0.
- `npm run build` — erfolgreich, Standalone-Ausgabe erzeugt.
- `npm run verify:http` Lauf 1 — rc=0, `PASS verify:http`.
- `npm run verify:http` Lauf 2 — rc=0, `PASS verify:http`.
- `npm run verify:http` Lauf 3 — rc=0, `PASS verify:http`.
- `npm run verify:all` — `PASS verify:all`.

## GELIEFERT / VERIFIZIERT WIE / OFFEN

GELIEFERT: Race-Sweep aller Browserprüfer unter `scripts/`, Vorab-Erwartungen für alle echten Navigations-/Serveraktionsrennen, Bericht.

VERIFIZIERT WIE: TypeScript, Build, drei sequenzielle HTTP-Suiten und vollständige Verify-Suite erfolgreich.

OFFEN: nichts.
