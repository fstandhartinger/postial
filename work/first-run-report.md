# First-run review

## GELIEFERT

- Der neue Browser-Test `scripts/verify-first-run-browser.ts` durchläuft Startseite, Login-Anforderung, Check-E-Mail, Magic-Link-Einlösung, erstes `/app`, Markenerstellung, Kanalvoraussetzung und ersten Composer-Schritt.
- Leere Posts-/Composer-Zustände erklären jetzt ausdrücklich die Voraussetzung „Marke zuerst“ und bieten genau einen primären Link zu `/app/brands`.
- Evidenz: `work/first-run-evidence/` mit jedem Zustand bei 390 und 1280 Pixeln.

| Schritt | Was der Nutzer sieht | War es eindeutig? | Was du geändert hast |
|---|---|---|---|
| Startseite | Postial-Startseite mit „Log in“/„Start free“ | Ja, Login mit einem Klick | Nichts |
| Anmeldung anfordern | Welcome-Seite, E-Mail-Feld und Magic-Link-Schaltfläche | Ja | Nichts |
| Magic-Link-Mail | „Check your email“ mit Adresse und Rücklink | Ja | Nichts |
| Erstes `/app` | Übersicht mit „Create your first brand“ | Ja | Nichts |
| Leerer Composer | Klare Erklärung, dass Posts zuerst eine Marke benötigen | Vorher nein, jetzt ja | Erklärender Leerzustand + Brand-Link |
| Marke verbinden | Markenansicht mit „Connect a channel“ und Setup-Hinweisen | Ja | Nichts |
| Erster Beitrag | Composer; ohne Kanal wird „Connect a channel“ verlinkt | Ja | Nichts |
| Leere Posts-Liste | Klare Erklärung „Create a brand before planning posts“ | Vorher nein, jetzt ja | Erklärender Leerzustand + Brand-Link |

## VERIFIZIERT WIE

- Vorher auf `main`: `FAIL first-run journey: locator.waitFor: Timeout ... waiting for ... Create a brand first`.
- Nachher: `PASS first-run journey: home → login → check email → magic link → app → brand → channel prerequisite → first post`; `PASS verify:http`.
- `npx tsc --noEmit`: PASS.
- `npm run build`: PASS.
- `npm run verify:all`: `PASS verify:all`.
- `npm run verify:http`: Journey-Test PASS; vollständiger Lauf lief bis zum bestehenden Login-Browser-Test, dessen erster Lauf am nicht zustellenden lokalen SMTP-Fixture-Transport stoppte. Der fixture-spezifische Skip ist korrigiert, ein erneuter Komplettlauf steht noch aus.

## OFFEN

- Kein Push, kein Deploy, keine Produktionsdaten und keine echten Mails verwendet.
- Offen: finalen kompletten `npm run verify:http`-Lauf nach dem SMTP-Fixture-Skip nochmals vollständig abwarten.
