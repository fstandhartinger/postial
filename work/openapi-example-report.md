# OpenAPI-Beispiele und Vertragstest

## GELIEFERT

- POST `/posts` hat wieder ein JSON-Beispiel. Brand- und Channel-IDs sind UUID-förmige Platzhalter; die direkt daneben stehende Zusammenfassung verlangt ausdrücklich die Ersetzung durch Werte aus `GET /v1/brands` und `GET /v1/brands/{brand_id}/channels`.
- Zusätzlich wurden nützliche, ebenfalls klar markierte Beispiele für PATCH `/posts/{id}`, POST `/webhooks` und POST `/posts/bulk` ergänzt. Es wurden keine API-Felder, Pfade oder Laufzeitverhalten geändert.
- `scripts/verify-openapi.ts` prüft jetzt jedes Request-/Response-Beispiel und jedes Schema-Beispiel auf Pflichtfelder, Typen, unbekannte Felder, Enum-/Const-Werte, Arrays, `oneOf`/`allOf`, relevante Längen sowie UUID-, URI- und Date-Time-Formate.

## VERIFIZIERT WIE

- `npx tsx scripts/verify-openapi.ts` → PASS (`12 paths, 16 operations`).
- Negativnachweis: Das POST-`/posts`-Beispiel wurde testweise auf `"body": 123` geändert. Der Prüfer schlug ab mit `...examples.placeholder.body: expected string`; die Teständerung wurde unmittelbar zurückgedreht und der Prüfer danach wieder erfolgreich ausgeführt.
- Mit `DATABASE_URL="$VERIFY_ADMIN_DATABASE_URL"` aus `.secrets.env` (ohne `VERIFY_ALLOW_SHARED_DB` und ohne `DATABASE_URL_LOCAL`): `npx tsc --noEmit` rc=0, `npm run build` rc=0, `npm run verify:all` PASS und anschließend vollständig `npm run verify:http` PASS.
- `git diff --check` ist sauber.

## OFFEN

Nichts im Umfang dieses Auftrags.
