# SSRF boundary verification

Stand: `main` 00788b3, isolierter Branch `test/ssrf-boundary`. Alle Tests waren offline: DNS wurde durch lokale Antworten ersetzt, `fetch` wurde gemockt oder an lokale Fixture-Sockets gebunden. Es gab keine Produktionsdatenbank, keinen Deploy und keine Anfrage an fremde Systeme.

## Aufrufpfade

| Kundenadresse | Server-Aufruf | Schutz | Beleg |
|---|---|---|---|
| Mastodon-Instanz | Account-Check, Instance-Limit und Publish | `httpsOrigin` als Syntaxprüfung, der anschließende `json`-Pfad nutzt `safeFetch` | `lib/publishers/mastodon.ts:27-29,35-47`; `lib/publishers/http.ts:76-77`; `lib/publishers/safe-fetch.ts:58-62` |
| Webhook-Endpunkt | Outbox-Delivery | Validierung über `validatePublicUrl`, Delivery über `safeFetch` | `lib/api/webhooks.ts:21-25,168-170` |
| Externe Medien | Post-Validierung und Publisher-Download | `validatePublicUrl` beim Speichern, `downloadImage`/`safeFetch` beim Abruf; Größenlimit zusätzlich im Stream | `lib/api/post-service.ts:44-49`; `lib/publishers/http.ts:102-124` |
| Link im Post | wird gespeichert bzw. als Browser-Link ausgegeben, nicht serverseitig abgerufen | kein serverseitiger Netzwerkpfad | `lib/api/post-service.ts:35-36,139-141`; `components/approvals/document.ts:17` |
| Provider-OAuth | feste Provider-Endpunkte, keine Kundenadresse | `jsonResponse`/`safeFetch`; lokale Fixture-Ausnahme nur Nicht-Produktion | `lib/publishers/oauth-http.ts:8-17` |

## Boundary-Fälle

| Fall | erwartet | tatsächlich | Beleg | Bewertung | Reparatur |
|---|---|---|---|---|---|
| 10.x, 172.16-31.x, 192.168.x | abgelehnt | abgelehnt, `fetch` 0-mal | `verify-ssrf-boundary.ts:15-19`; Ausgabe `20/20 pass` | hält | keine |
| 127.0.0.1, ::1, 0.0.0.0 | abgelehnt | abgelehnt, `fetch` 0-mal | `verify-ssrf-boundary.ts:15-19`; bestehend zusätzlich `verify-publishers.ts:259-266` | hält | keine |
| 169.254.169.254 und Link-Local IPv6 | abgelehnt | abgelehnt, `fetch` 0-mal | `verify-ssrf-boundary.ts:15-19` | hält | keine |
| IPv6 unique-local (`fc00`, `fd12`) und IPv4-in-IPv6 | abgelehnt | abgelehnt | `safe-fetch.ts:9-14`; `verify-ssrf-boundary.ts:15-19` | hält | keine |
| Dezimal, Oktal, Hex (`2130706433`, `0177.0.0.1`, `0x7f000001`) | abgelehnt | abgelehnt vor `fetch`; URL-Parser normalisiert auf Loopback | `verify-ssrf-boundary.ts:17-19` | hält | keine |
| DNS-Name mit privater Antwort | abgelehnt | abgelehnt, gemischte Antwort erzeugt 0 Requests | `safe-fetch.ts:27-35`; `verify-ssrf-boundary.ts:36-44`; bestehend `verify-publishers.ts:271-273` | hält | keine |
| Redirect öffentlich → privat | abgelehnt | genau 1. Request, kein Redirect-Ziel | `safe-fetch.ts:63-69`; `verify-ssrf-boundary.ts:46-55` | hält | keine |
| anderes Protokoll / HTTP | abgelehnt | abgelehnt vor `fetch` | `safe-fetch.ts:21`; `verify-ssrf-boundary.ts:17-19` | hält | keine |
| DNS-Prüfung öffentlich, Verbindung danach potenziell privat | private Verbindung darf nicht erreicht werden | Connector liefert ausschließlich die geprüften IPs; Host/SNI bleibt erhalten | `safe-fetch.ts:37-45,58-62`; `verify-publishers.ts:301-326`: `real TLS connector pins checked IP, preserves SNI and verifies certificates` | hält | keine |
| Antwort größer als Limit | abgelehnt | abgebrochen bei Header- oder Stream-Überschreitung | `safe-fetch.ts:71-87`; `verify-publishers.ts:275-279,409-422` | hält | keine |
| langsame Gegenstelle | abgebrochen | 20 s pro Request; Stream teilt dasselbe Signal; Publishing 90 s gesamt | `safe-fetch.ts:47-53`; `http.ts:70-85`; `verify-publishers.ts:281-300,328-338` | hält | keine |

## Kontrollierte Ausnahme

`lib/api/webhooks.ts:16-20,24` und `lib/media/url.ts:localMediaUrl` erlauben Loopback nur bei `NODE_ENV !== production` und einem expliziten Fixture-Schalter. Die Delivery umgeht dort bewusst `safeFetch` (`webhooks.ts:169`), damit lokale Offline-HTTP-Fixtures möglich sind. In Produktion ist die Bedingung immer falsch; dies ist kein Produktionspfad. Die bestehende HTTP-Prüfung belegt ausdrücklich `production SSRF guard`.

## Änderungen

Es wurde keine echte Lücke gefunden und daher keine Laufzeitreparatur vorgenommen. Ergänzt wurden ausschließlich:

- `scripts/verify-ssrf-boundary.ts`: 20 wiederholbare Offline-Regressionsfälle.
- `scripts/verify-suite.mjs`: Einhängung in `verify:all`.

## GELIEFERT / VERIFIZIERT WIE / OFFEN

**GELIEFERT:** Systematische SSRF-Aufrufpfad-Analyse, Boundary-Test und dieser Bericht.

**VERIFIZIERT WIE:** `npx tsx --test scripts/verify-ssrf-boundary.ts` → 20/20 PASS; `npx tsx --test scripts/verify-publishers.ts` → 78/78 PASS; `npx tsc --noEmit` rc=0; `npm run build` erfolgreich; `npm run verify:all` PASS; `npm run verify:http` PASS.

**OFFEN:** Keine Produktionslücke. Die nicht-produktive Loopback-Ausnahme bleibt als bewusst dokumentierter Fixture-Pfad bestehen.
