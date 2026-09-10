# Approval E2E report

| Schritt | was der Kunde sieht | Bewertung | Korrektur |
|---|---|---|---|
| Link öffnen, ohne Konto | Marke „Maple Studio“, Beitrag, Zielkanal Mastodon, Zeitplan und klare Buttons „Approve“ / „Request changes“ | PASS – Zweck und freigebende Partei erkennbar | Keine |
| Änderung erbeten | Pflichtname, Kommentarhinweis, bestätigte Speicherung | PASS – Entscheidung eindeutig rückmeldbar | Keine |
| Agentur-Nachbesserung | Agentur sieht „Changes requested“ und den Kommentar, bearbeitet und sendet neu | PASS | Keine |
| Erneut öffnen und freigeben | Revidierter Inhalt, danach Bestätigung und „Approved by Anna Client“ | PASS | Keine |
| Agenturstatus / Veröffentlichung | Agentur sieht Approval-Historie; Fixture-Publisher führt den Beitrag auf „published“ | PASS, Provider-Aufruf blieb Attrappe | Keine |
| Replay, manipulierter Token, Doppelklick, Weiterleitung | Ungültiger/alter Token 404; nach Veröffentlichung 409; zwei Browser können nur lesen | PASS – keine doppelte Entscheidung/Wirkung | Keine |
| Datenumfang | Nur zugeteilter Beitrag, Marke und Zielkanal; keine internen IDs, Sessiondaten oder Credentials | PASS | Keine |

GELIEFERT

- `scripts/verify-approval-e2e.ts` als zusammenhängender Playwright-Verifier.
- Screenshots für 390 und 1280 Pixel unter `work/approval-evidence/`.
- Suite um den E2E-Lauf ergänzt.

VERIFIZIERT WIE

- Isolierte Datenbank über `verify-suite.mjs`; `VERIFY_ALLOW_SHARED_DB` nicht gesetzt.
- Frische anonyme Browserkontexte, Agency-Kontext mit synthetischer Session, keine echten Mails oder Provider-Aufrufe.
- Browserpfad, HTML-Projektion, Replay/Tamper/Concurrent-Checks und DB-Zustände geprüft.

OFFEN

- Vollständige `verify:all`, `verify:http`, TypeScript-Prüfung und Build werden nach dem E2E-Lauf ausgeführt; bei Fehlern wird der Branch nicht als produktionsreif bewertet.
