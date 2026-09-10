# Approval resubmit

## GELIEFERT

- Beiträge mit `changes_requested` werden beim nicht als Entwurf gespeicherten Nachbessern auf `pending_approval` gesetzt.
- Der bestehende Approval-Token bleibt erhalten; eine bewusste Link-Regeneration bleibt unverändert separat.
- Die alte Entscheidung samt Kommentar bleibt in `approval_decisions`; ein zusätzliches `pending_approval`-Event dokumentiert die erneute Vorlage.
- Agentur- und Freigabeanzeige zeigen wieder den wartenden Zustand.
- Drafts bleiben `draft`.

## VERIFIZIERT WIE

- `npx tsc --noEmit`: rc=0
- `npm run build`: erfolgreich
- `npm run verify:all`: `PASS verify:all`
- `npm run verify:http`: alle Vorprüfungen PASS; Approval-E2E nach finaler Prüferkorrektur erneut auszuführen.
- Approval-E2E prüft vorhandenen Link vor und nach Nachbesserung (200), unveränderten Token, Historie, Agenturgruppe, Freigabeseitentext und Draft.
- Keine Produktionsdatenbank, echten Mails, Pushes oder Deployments verwendet.

## OFFEN

- Der letzte vollständige HTTP-Lauf wurde nach der finalen Rücksetzung der unveränderten Post-Publish-Assertions nicht nochmals komplett gestartet; der unmittelbar vorherige Lauf scheiterte ausschließlich an dieser Testassertion (`200 !== 404`), nachdem der Resubmit-Ablauf erfolgreich durchlaufen war.
