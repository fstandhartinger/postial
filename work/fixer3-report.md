# SocialMint – Fixer Zyklus 3

09.09.2026. Ausgangspunkt `307c690`, isolierter Branch `fixer3`. E01–E12 umgesetzt.

| Befund | Gelieferte Änderung | Verifikation |
|---|---|---|
| E01 | Ereignis-Allowlist: `approval.decided.data` enthält nur `post_id`, `brand_id`, `decision`, `decided_at`, `has_comment`, `post_url`. GET-Detail liefert autorisierte `approvals[]`. Migration 0007 entfernt alte Outbox-Namen/Kommentare. Docs/OpenAPI aktualisiert. | Lokaler HMAC-Empfänger, genaue Feldmenge und Detail-Historie geprüft. Vollständige Migrations-SQL zusätzlich auf isolierten temporären Tabellen mit alter PII-Payload ausgeführt. |
| E02 | `lib/entitlements.ts` entscheidet allein: Trial bis `trialEnd`; bezahlt bis `currentPeriodEnd + 3 Tage`; `past_due` zusätzlich maximal sieben Tage. Fehlende Daten/Stripe-ID sperren. API, Worker, Webhooks und UI verwenden diese Entscheidung. | Abgelaufener Trial: HTTP 403 und Worker `held`, ohne Publisher-Aufruf; Recovery. Datumsgrenzen, fehlende Daten und Canceled-Regression geprüft. |
| E03 | Zentrales `approvalLinks`-Entitlement; gemeinsamer UI/API-Save-Service lehnt Starter-Freigaben mit 422 ab. Composer deaktiviert Checkbox und verlinkt Upgrade. Onboarding-Schritt 4 zeigt denselben Hinweis. Vorhandene Freigaben bleiben lesbar. | Starter-Save-Service mit `requiresApproval` aufgerufen und Fehler als 422 geprüft; Starter-API-Zugang bleibt 403. Playwright 390/1280 prüft Checkbox und Upgrade. Agency-Composer und öffentliche Approval-Regression bestehen. |
| E04 | Publishing wartet nicht auf Webhooks. Separater `deliverWebhooksTick()` mit eigenem Guard nach Publishing im selben Intervall. Concurrency vier, Request-Timeout fünf Sekunden, zehn Sekunden Budget mit Reserve für Ergebniswrites; keine neue Batch unmittelbar am Budgetende. | 1,5-s-Empfänger: Publishing 6 ms gegenüber 7 ms Basis. Zehn 6-s-Requests: Dispatcher 9.819 ms, maximal vier gleichzeitige Requests und fünf Sekunden Request-Timeout. |
| E05 | Transaktionales Disable → `paused`, Enable → `pending`, Delete → `canceled`. Soft-Delete erhält Audit-Verlauf und entfernt Signing-Credentials. Entitlement-Pausen verbrauchen keine Versuche und werden automatisch fortgesetzt. UI bietet Enable/Delete und zeigt Zustände/Gründe. | DB/HTTP: Disable ohne Versuch, Enable, Ablauf-Pause, Recovery, Delete mit canceled-Log und vernichtetem Secret; Reaktivierung gelöschter Endpoints abgelehnt. |
| E06 | Unbekannte/fremde Kanäle oder Kanäle außerhalb der gewählten Brand liefern 404 `not_found`; danach Aktivstatusvalidierung eigener Kanäle. | Eigene Brand mit fremder und zufälliger Kanal-ID liefert HTTP 404. Docs/OpenAPI angepasst. |
| E07 | DNS-Prüfung auf drei Sekunden begrenzt. Post-Service übersetzt DNS/SSRF-Fehler in `InputError` mit `media_urls[index]`; API 422 und dieselbe UI-Fehlermeldung. | Nicht auflösbarer `.invalid`-Medienhost und private Adresse liefern 422. Adapter-SSRF-, DNS-, Pinning- und Deadline-Tests bestehen. |
| E08 | V1-Catch-all liefert JSON-404; explizite 405-Handler liefern JSON und `Allow`. API-weites `Cache-Control: no-store`, einschließlich OPTIONS/Routingfehler. HEAD bleibt gemäß HTTP ohne Body. | Produktionsserver: `/api/v1/nonexistent` JSON 404; POST `/api/v1/me` JSON 405 + Allow; beide no-store. |
| E09 | Verbindungsvalidierung übersetzt AUTH_EXPIRED zu „Check the token/app password and scopes, then connect again.“ Bestehende Publishing-Targets behalten Reconnect-Hinweise. | Alle drei Adapter mit gemocktem 401 in beiden Kontexten geprüft; insgesamt 61/61 Adaptertests. |
| E10 | Publish/Schedule ohne ausgewählten verfügbaren Kanal deaktiviert; Inline-Hinweis „Connect a channel to publish“ mit Link. Draft bleibt möglich. | Playwright 390/1280: beide Publishing-Modi deaktiviert, Save draft aktiviert. |
| E11 | `npm start` startet `.next/standalone/server.js`; Postbuild kopiert `public` und `.next/static`. README stimmt mit bestehendem Docker-Standalone-Layout überein. | Produktionsbuild/Postbuild und realer `npm start`; HTTP/API und Browser dagegen. Keine Standalone-Startwarnung. |
| E12 | Delivery-Karten unter 768 px, Tabelle ab 768 px; Status, Versuche, HTTP, Zeitpunkte und Pausengrund lesbar. | Playwright 390/1280 prüft Darstellung und fehlenden Seitenoverflow. Screenshots visuell geprüft. |

## Ausgeführte Prüfungen

Bestanden: `npm run lint`, `npx tsc --noEmit`, `npm run build`, `npm run db:migrate`, `scripts/verify-api.ts` (HTTP-Harness und gebautes Next.js), `scripts/verify-core.ts`, `scripts/verify-approvals.ts` einschließlich Playwright, `scripts/verify-publishers.ts` (61/61). Zusätzlich `verify-entitlements.ts`, `verify-fixer3-migration.ts`, `verify-fixer3-browser.ts`, `git diff --check` und Secret-Scan geänderter/neuer Dateien sowie Evidence-Logs gegen verfügbare Secret-Werte und Credential-Muster.

Artefakte: `work/fixer3-evidence/` enthält Logs, Composer ohne Kanal und Starter-Composer jeweils 390/1280, Settings-Log 390/1280, Starter-Onboarding und mobilen Approval-Nachweis. Testskripte sind im Repository enthalten. Synthetische Benutzer werden in `finally` entfernt; Cascades entfernen deren Workspaces, Sessions und Testdaten. Migrationsregression verwendet temporäre Tabellen.

Der erste Worktree-Build lehnte den externen node_modules-Symlink ab; lokale `npm ci`-Installation behob dies. Die Approval-Browserfixture besitzt jetzt ein gültiges Agency-Abo. Browserprüfungen warten explizit auf die relevante gestreamte Oberfläche. Der Budgettest führte zur Sperre weiterer Claims unmittelbar vor Deadline-Ende. Finale Prüfungen bestehen.

## Grenzen

Keine Produktionsmigration/Deployment, kein automatisierter Login, keine echten Social-Posts oder Zahlungen, keine externe Kunden-Webhook-Zustellung. Lokale Empfänger, gemockte Adapter und synthetische DB-Sessions; der Testserver hält seinen automatischen Worker per bestehendem Test-Preload von UI-Fixtures fern. Bereits laufende Webhook-Requests können bei Disable/Delete noch ankommen; dokumentiert. Das Zeitbudget begrenzt Netzwerkaktivität und reserviert Zeit für Ergebniswrites; ein Datenbankausfall ist keine harte Echtzeitgarantie. C07/C08 und die bekannte produktive Login-/Provider-/Stripe-Abnahme bleiben außerhalb E01–E12 offen.

GELIEFERT: E01–E12, Migration 0007, Docs/OpenAPI, Regressionstests und Screenshots.
VERIFIZIERT WIE: PostgreSQL, Produktionsbuild/HTTP, HMAC/Timeout-Empfänger, 61 Adaptertests, Playwright 390/1280, Secret-Scan.
OFFEN: Keine E01–E12-Restarbeit; bekannte separate Freigabevoraussetzungen wie oben.
