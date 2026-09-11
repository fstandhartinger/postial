# Dokumenten-Wahrheitsprüfung Postial

## GELIEFERT

- Die fünf Anleitungen `connect-bluesky`, `connect-mastodon`, `brands`, `calendar` und `billing` wurden gegen Adapter, Entitlements, Planwerte und die gerenderten App-Seiten geprüft.
- Es wurde keine Aussage geändert: Keine der überprüfbaren Aussagen wird durch den Code widerlegt; daher gibt es keine Vorher/Nachher-Korrekturen zu dokumentieren.
- `scripts/verify-docs-truth.ts` wurde erstellt und in `scripts/verify-suite.mjs` als `docs-truth.ts` registriert.

## VERIFIZIERT WIE

- Provider und Limits: `lib/publishers/bluesky.ts:46-50,68-76` (300 Grapheme, vier Bilder, 1.000.000 Bytes) und `lib/publishers/mastodon.ts:18-23,37-54` (500-Fallback, dynamisches Instanzlimit, vier Bilder, 16.000.000 Bytes).
- Planlimits: `lib/plans.ts:7-8` (Starter 3 Marken/1 Sitz, Agency 15 Marken/5 Sitze); die aktive Markenreihenfolge und Read-only-Grenze kommen aus `lib/entitlements.ts:23-24`.
- Verbindungsschritte und Provider-Auswahl: `app/app/brands/[id]/page.tsx:51-113`.
- Kalenderlabels und Reschedule-Zustände: `app/app/calendar/page.tsx:27-42`, `app/app/posts/[id]/page.tsx:29-32,71` und `lib/api/post-service.ts:296-303`.
- Billing-Anzeige und Trial/Portal-Schritte: `app/app/billing/page.tsx:37-43` und `app/app/billing/page.tsx:33-34`.
- Der neue Verifier bindet diese Aussagen an dieselben Adapter-, Plan- und UI-Quellen, damit Produktänderungen den Lauf fehlschlagen lassen.

## OFFEN

- Keine durch den Code belegte Abweichung in den fünf geprüften Seiten.
- Vollständiger Acceptance-Lauf nach dem letzten Bericht-Commit: `work/acceptance.json` meldet `ok: true`, `clean: true`, den dort ausgewiesenen Commit, und `directory: /tmp/postial-docs`. `tsc --noEmit`, `next build`, `verify:all` und `verify:http` meldeten jeweils `returnCode: 0`; letzte Ausgaben waren für die Verifikationen `PASS verify:all` und `PASS verify:http`.
- Der Supervisor bestätigte für denselben Lauf die Zeile `run-verification: verifying /tmp/postial-docs at <acceptance commit>`.
