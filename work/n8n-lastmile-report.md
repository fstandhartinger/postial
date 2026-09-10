# n8n Last-Mile Report

## GELIEFERT

- Isolierter Browser-/HTTP-Regressionstest `scripts/verify-n8n-lastmile-browser.ts`, eingebunden in `scripts/verify-suite.mjs`.
- API-Key-Oberfläche mit verständlichen Scopes, n8n-Anforderungs-Hinweis, einmaliger Anzeige, explizitem Copy-Button und ehrlichem Agency-/Trial-Leerzustand.
- n8n-Dokumentation auf veröffentlichtes Paket `n8n-nodes-socialmint` 0.1.2, Postial-Namen und Basis-URL aktualisiert.
- Evidence: `work/n8n-lastmile-evidence/n8n-lastmile-key-390.png` und `work/n8n-lastmile-evidence/n8n-lastmile-key-1280.png`. Der Key wurde vor dem Screenshot im DOM durch `REDACTED_FOR_EVIDENCE` ersetzt.

## VERIFIZIERT WIE

Der Test nutzt `verify-suite.mjs` mit Wegwerf-Postgres und zufälligem Auth-/Encryption-Key. Anonymous `/app` liefert 307 zur Anmeldung; die isolierte Session öffnet `/app`, dann Settings → API settings. Danach erzeugt der Nutzer einen Wegwerf-Key, ruft mit Bearer-Key `GET /api/v1/brands` (200) und `POST /api/v1/posts` als Draft (201) auf. Nach Reload ist der One-time-Key nicht mehr im DOM.

Vorher/Nachher: Der neue Test schlug am Ausgangsstand bei der Scope-Verständlichkeit fehl: `assert(await form.getByText('n8n needs', { exact: false }).isVisible())` in `scripts/verify-n8n-lastmile-browser.ts:33`. Nach der Korrektur PASS: `PASS n8n last-mile: /app → API settings → one-time key → brands → draft` und `PASS verify:http` im gezielten Lauf; der vollständige `verify:http` lief anschließend ebenfalls PASS.

| Prüfpunkt | Befund | Datei:Zeile | Korrektur |
|---|---|---|---|
| Auffindbarkeit ab `/app` / Benennung | In 2 Klicks über Settings → API settings; UI heißt API & webhooks, Doku verlinkt API settings | `app/app/layout.tsx:47-48`, `app/app/settings/team/page.tsx:15`, `app/app/settings/api/page.tsx:15-28`, `content/help/n8n.md:9,15` | Keine Navigationsänderung nötig; Regressionstest deckt den Weg ab |
| Einmalige Klartext-Anzeige | Ausgangsstand zeigte Hinweis und selektierbares Feld, aber keinen expliziten Copy-Button | `components/settings/ApiForms.tsx:22`, `app/app/settings/api/actions.ts:22` | Copy API key ergänzt; Hinweis „will not be shown again“ bleibt sichtbar |
| Scopes / n8n-Bedarf | Roh-Scopes waren ohne Erklärung; Doku listete Anforderungen, UI nicht | `components/settings/ApiForms.tsx:4-10,17` | Jede Berechtigung erklärt; n8n-Bedarf direkt über der Auswahl genannt |
| Plan-Gate | Agency inklusive Agency trial erforderlich; Starter-Zustand zeigt Upgrade to Agency statt leerer Maske/Fehler | `app/app/settings/api/page.tsx:21-25`, `lib/api/auth.ts:12-16` | Keine Verhaltensänderung; Test prüft den ehrlichen Hinweis |
| Basis-URL | API bedient `/api/v1`; n8n-Credential nutzt Origin `https://postial.co`; Doku nennt beides passend | `content/help/n8n.md:30`, `app/docs/api/page.tsx:24,67`, `app/api/v1/me/route.ts:5` | Veraltete n8n-Installations-/Statusaussage korrigiert |

## OFFEN

- Keine nicht auflösbaren Widersprüche festgestellt. Keine Produktionsdaten, Provider-Posts, echten Mails oder Deployments verwendet.

## Abschluss

GELIEFERT: Last-mile UI, Doku, isolierter End-to-End-Test und Screenshots.

VERIFIZIERT WIE: `npx tsc --noEmit` rc=0; `npm run build` erfolgreich; `npm run verify:all` PASS; vollständiges `npm run verify:http` PASS; gezielter n8n-Test PASS.

OFFEN: nichts.
