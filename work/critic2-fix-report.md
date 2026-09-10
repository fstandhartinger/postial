# Critic 2 Fix Report

## GELIEFERT

- Approval-Prüfsumme bindet jetzt Markenname, Markenfarbe und Zeitzone; Anzeige und Entscheidung berechnen dieselbe Version.
- Übersicht verwendet den gewählten Markenfilter für Kanäle und Beiträge.
- Der Kanal-Schritt der Startliste gilt nach dem ersten angelegten Kanal als erledigt und erscheint nach Trennung nicht erneut.
- Wächterabfragen in `ops/watch-socialmint.py` und `ops/fixture-check.py` sind auf gezielte Fixture-Prädikate und `LIMIT 100` umgestellt. Ops-Dateien wurden direkt geändert und nicht committet.

## VERIFIZIERT WIE

- Regressionsevidenz P1–P3: Negativprobe des alten Verhaltens ausgegeben; danach PASS für alle drei sichtbaren Prüfsummenfelder, Markenfilter und historische Kanal-Erledigung.
- P4: `python3 -m unittest discover -p 'test_*.py'` in `ops`: 22 Tests, OK. Query-Nachweis: alle Nutzer-, Kanal-, veröffentlichten Beitrag-, Abonnement- und Fixture-Abfragen enthalten `LIMIT 100` bzw. Fixture-Prädikate.
- `npx tsc --noEmit`: rc=0.
- `npm run build`: erfolgreich.
- `npm run verify:all`: PASS verify:all.
- `npm run verify:http`: PASS verify:http; alle browserlastigen Läufe vollständig abgeschlossen.

## OFFEN

- Nichts.
