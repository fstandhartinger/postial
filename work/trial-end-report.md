# Trial-End-Qualitätsprüfung

## GELIEFERT

Die Prüfung lief im Worktree `test/trial-end` gegen eine disposable Verify-Datenbank aus `VERIFY_ADMIN_DATABASE_URL`. Es wurden keine Produktionsdaten, Stripe-Aufrufe, Provider-Aufrufe oder echten Mails verwendet. Provider und Mail waren Attrappen; der Test registriert einen synthetischen Mastodon-Publisher und zählt seine Aufrufe.

| Zustand | eingeplanter Beitrag | Hinweis in der App | Grenzen | Daten erhalten? | Bewertung | Beleg | Korrektur |
|---|---|---|---|---|---|---|---|
| Trial läuft | veröffentlicht, wie vorgesehen | `Your trial ends soon`, Billing-Schritt | Agency: 15 Marken/5 Sitze/API/Approval Links | Ja | PASS | `scripts/verify-trial-end.ts:18,48-67`; `components/billing/TrialBanner.tsx:10` | keine |
| Trial endet heute | `held`, kein Provider-Aufruf | `Your trial has ended`, `N posts currently held`, `Update billing` | Starter-Fallback: 3/1/kein API/keine Approval Links | Ja | PASS; exakt ab `trialEnd <= now` gesperrt | `scripts/verify-trial-end.ts:19,50-67`; `lib/trial-notice.ts:5-6` | keine |
| Trial abgelaufen, kein Zahlungsmittel | `held`, kein Provider-Aufruf | abgelaufener Trial-Hinweis und Billing-Schritt | Starter-Fallback: 3/1/kein API/keine Approval Links | Ja | PASS | `scripts/verify-trial-end.ts:20,54-67`; `components/billing/TrialBanner.tsx:9-10` | keine |
| Abo aktiv | veröffentlicht | kein Trial-Hinweis; Billing zeigt Laufzeit | Agency: 15/5/API/Approval Links | Ja | PASS | `scripts/verify-trial-end.ts:21,54-67` | keine |
| Abo gekündigt zum Periodenende | bis Periodenende/Reconciliation veröffentlicht | kein Trial-Hinweis; Kündigungsstatus im Billing | Agency: 15/5/API/Approval Links | Ja | PASS | `scripts/verify-trial-end.ts:22,46-67`; `lib/entitlements.ts:11,16` | Billing-Text präzisiert |
| Periodenende überschritten | `held`, kein Provider-Aufruf | generischer Hinweis `N posts paused`, `Update billing` | Starter-Fallback: 3/1/kein API/keine Approval Links | Ja | PASS; nach 3-Tage-Nachfrist gesperrt | `scripts/verify-trial-end.ts:23,54-67`; `components/billing/TrialBanner.tsx:9` | Billing-Text präzisiert |
| Zahlung fehlgeschlagen | `held`, kein Provider-Aufruf | generischer pausierter-Beiträge-Hinweis und Billing-Schritt | Starter-Fallback: 3/1/kein API/keine Approval Links; `past_due`-Zugang endet bei 7 Tagen | Ja | PASS | `scripts/verify-trial-end.ts:24,54-67`; `lib/entitlements.ts:12-14` | Billing-Text präzisiert |

Ein pausierter Beitrag läuft nach Wiederherstellung eines aktiven Zahlungsmittel-Zustands wieder an und wird veröffentlicht; der Datensatz und Inhalt bleiben erhalten (`scripts/verify-trial-end.ts:69-80`). Es gibt keinen Datenverlust.

## VERIFIZIERT WIE

- `scripts/verify-trial-end.ts:17-24` baut alle sieben Zustände direkt in der isolierten Datenbank.
- `scripts/verify-trial-end.ts:50-65` prüft Zugang, UI-Notice, Limits, Beitragstatus und Provider-Aufrufe je Zustand.
- `lib/entitlements.ts:9-16` bestätigt die Grenzen: Trial endet exklusiv bei `now >= trialEnd`; bezahlte Perioden haben drei Tage Reconciliation; `past_due` hat maximal sieben Tage ab `pastDueSince`.
- Der Reparaturtest ist absichtlich regressionsfest: ohne den neuen Billing-Text schlägt `scripts/verify-trial-end.ts:28` am Textassert fehl; mit Korrektur läuft die Matrix grün. Vorher-Beleg: alter Text behauptete „Scheduled posts then pause“ direkt am Periodenende, obwohl `lib/entitlements.ts:11` noch drei Tage Zugang erlaubte. Nachher-Beleg: `app/app/billing/page.tsx:33` nennt die bis zu drei Tage Reconciliation ausdrücklich.
- Vorher-Fehlerausgabe des Reparaturtests (erwartet): `AssertionError: value does not match regular expression /Renewal reconciliation may take up to three days.../`.
- Nachher-Ausgabe: `PASS trial-end matrix: ... period-ended: access=false postTarget=held ... payment-failed: access=false postTarget=held ... resume=published; data=retained; ... no Stripe/mail calls`.

Ergebnisse der geforderten Checks:

- `npx tsc --noEmit`: rc=0
- `npm run build`: erfolgreich
- `npm run verify:all`: `PASS verify:all`
- `npm run verify:http`: `PASS verify:http`

## OFFEN

Keine blockierenden Befunde. Die Rechnungslogik wurde nicht verändert; geändert wurde nur die irreführende Billing-Erklärung zur bestehenden Drei-Tage-Reconciliation. Preise und Plangrenzen blieben unverändert.
