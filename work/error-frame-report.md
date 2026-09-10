# Error-frame report

## GELIEFERT

- `error_events.source_location` als nullable, additive und idempotente Migration `0019` ergänzt.
- Stack-Auswertung speichert nur projektrelativen eigenen Ort (`Datei:Zeile (Funktion)`), überspringt `node_modules`, Runtime und Framework; Fallbacks enthalten keine externen Pfade.
- Cause-Kette bis drei Ebenen: der erste eigene Rahmen der tiefsten Ursache wird verwendet.
- Fingerprint bindet den Quelltext-Ort ein; Erfassung bleibt vollständig best effort.

## VERIFIZIERT WIE

- Gezielter Test: bekannte Datei/Funktion, tiefste Ursache, Datenschutz-Allowlist und persistierte Feldform: PASS.
- `npx tsc --noEmit`: rc=0.
- `npm run build`: erfolgreich.
- `npm run verify:all`: `PASS verify:all`.
- `npm run verify:http`: `PASS verify:http`; Browserläufe nacheinander vollständig beendet.

## OFFEN

- Nichts im vereinbarten Umfang. Kein Push, kein Deploy und keine Produktionsdatenbank verwendet.
