GELIEFERT
- Zentrale redigierte Fehlererfassung für API-Routen, Serverfehler/Actions, Worker und Prozess-Ausnahmen.
- DB-Migration 0017 mit 14-Tage-Retention, atomarem Stunden-Zähler und 500 gespeicherten Fehlern/Stunde; Health enthält `errorsLastHour`.
- Keine E-Mail-Adressen, Tokens, Zugangsdaten, Beitrags-/Medieninhalte oder Request Bodies in Log/DB.

VERIFIZIERT WIE
- `npx tsc --noEmit`: rc=0; `npm run build`: erfolgreich.
- `npm run verify:all`: PASS (isolierte Datenbank); neuer Test: API+Worker, Redaction, Best-Effort-Ausfall, Cap PASS.
- `npm run verify:http`: PASS; `verify-media`: sichere 500-Fehlerzeile und Payload-Redaction PASS.

OFFEN
- Keine offenen Punkte. Kein Push, Deploy, Provider-Aufruf oder Produktionsdatenbankzugriff.
