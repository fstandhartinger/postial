# Postial: öffentliche Angriffsfläche

Audit gegen Commit `efd05ab`, isolierter Worktree, ohne Produktionsanfragen,
echte Mails oder Provider-Aufrufe. `proxy.ts` läuft für alle Pfade
(`proxy.ts:36,66`); POST-Bodies werden vor Server-Action-Verarbeitung auf
64 KiB begrenzt (`proxy.ts:50-51`, `lib/http/body.ts:6-30`).

## Endpunkt-Matrix

| Endpunkt | Methode | Auth | Ratenbegrenzung | teure Wirkung | Bewertung | Beleg | Reparatur |
|---|---|---|---|---|---|---|---|
| `/api/v1/*` bekannte Ressourcen (`/me`, `/brands`, `/media`, `/posts`, `/webhooks`) | GET/POST/PATCH/DELETE je Route | Bearer API-Key + Agency + Scope | 60/min/API-Key (`lib/api/auth.ts:34-48`) | DB-Abfragen, Medienverarbeitung und Webhook-Test erst nach Auth; Webhook-Test max. 10/h/Workspace (`lib/api/webhooks.ts:69-70`); Upload 30/min/User/Workspace (`lib/media/request.ts:6-8`) | in Ordnung: kein anonymer Zugriff; unbekannt/fremd 401/404, Fehlerhülle ohne Interna | `app/api/v1/*/route.ts` delegiert an `endpoint`; `lib/api/auth.ts:34-55`; `lib/api/errors.ts:9-19` | keine |
| `/api/v1/*` unbekannte Pfade | GET/POST/PUT/PATCH/DELETE | keine, aber immer 404 | keine DB-/Provider-Wirkung | keine | in Ordnung: konstantes JSON-404 | `app/api/v1/[[...path]]/route.ts:1-6`, `lib/api/routing.ts:1-2` | keine |
| `/api/admin/funnel` | GET | Sitzung + Admin-E-Mail | keine eigene; Proxy greift nicht ein | Aggregation max. 365 Tage; nur Admin | in Ordnung | `app/api/admin/funnel/route.ts:5-10`; `lib/funnel.ts:63-81` | keine |
| `/api/internal/tick` | POST | `x-cron-secret` timing-safe | keine, Secret-Gate | Publikations-/Webhook-Worker erst nach Secret | in Ordnung | `app/api/internal/tick/route.ts:4-20` | keine |
| `/api/media` | POST | Sitzung, Same-Origin falls Origin vorhanden | 30/min/User/Workspace; Body max. Bildgröße + 64 KiB | Sharp/Bildspeicher/DB erst nach Sitzung; Größen- und Typprüfung | in Ordnung | `app/api/media/route.ts:5-8`; `lib/media/session.ts:3-8`; `lib/media/request.ts:6-24` | keine |
| `/api/media/:id` | DELETE | Sitzung + Workspace | 120/min/User | DB-Löschung erst nach Sitzung | in Ordnung | `app/api/media/[id]/route.ts:5-7`; `lib/rate-limit.ts:19-22` | keine |
| `/api/auth/[...nextauth]` | GET/POST | Auth.js öffentlich; Provider-/Callback-Prüfungen | Mail: 3/15min/Empfänger und 10/h/IP; Action zusätzlich 10/min/IP | höchstens begrenzter Mailversand; DB-Token nur innerhalb Auth.js-Limits; Body max. 64 KiB | repariert: vor dem Fix konnte der Login-Server-Action unbegrenzt `signup_started` in die DB schreiben, bevor das Mail-Limit griff | `app/api/auth/[...nextauth]/route.ts:5-9`; `lib/auth-email.ts:5-53`; `app/login/page.tsx:33-39` | `lib/auth-email.ts:11-24`, `app/login/page.tsx:33-39`; Regressionstest `scripts/verify-signin-ratelimit.ts:39-52` |
| `/api/oauth/:provider/start` | POST | Sitzung + Same-Origin + gültiger Provider | 120/min/User | OAuth-Start/DB-Zustand erst nach Auth; ausgehender Provider-Aufruf | in Ordnung | `app/api/oauth/[provider]/start/route.ts:9-19`; `lib/rate-limit.ts:19-22` | keine |
| `/api/oauth/:provider/callback` | GET | Sitzung + State/PKCE/Provider-Bindung | 120/min über Auth-Action-Budget im Flow | Token-Austausch erst nach Sitzung und State-Prüfung; Fehler nur Redirect-Code | in Ordnung | `app/api/oauth/[provider]/callback/route.ts:9-19`; `lib/publishers/oauth.ts` | keine |
| `/api/stripe/checkout` | POST | Sitzung + Workspace-Billing-Owner | keine eigene; Lease/Idempotency pro Workspace | Stripe Customer/Checkout erst nach Auth; wiederholte Requests werden geleast/idempotent | in Ordnung; anonymer Aufruf 401 ohne Stripe-Aufruf | `app/api/stripe/checkout/route.ts:14-77`; `lib/billing.ts` | keine |
| `/api/stripe/portal` | POST | Sitzung + Billing-Owner | keine eigene; idempotenter Schlüssel pro Workspace | Stripe-Portal erst nach Auth und vorhandenem Customer | in Ordnung | `app/api/stripe/portal/route.ts:5-12`; `lib/stripe-idempotency.ts` | keine |
| `/api/stripe/webhook` | POST | Stripe-Signatur | keine IP-Limitierung; Body max. 512 KiB | Stripe-/DB-Reconciliation und einzelne Stripe-Retrieves; ohne gültige Signatur kein Effekt | in Ordnung: ungültig 400, interne Fehlerhülle 500 | `app/api/stripe/webhook/route.ts:112-131`; `lib/http/body.ts:3-4,6-30` | keine |
| `/api/waitlist` | POST | anonym; Origin optional geprüft | 10 Registrierungen/h/IP, Proxy-IP nur rechter Hop | eine kleine DB-Transaktion; kein Mail-/Provider-Aufruf; Body max. 4096 B | repariert: zuvor verriet 201 vs. 200, ob E-Mail/Netzwerk bereits registriert war | `app/api/waitlist/route.ts:12-46` | einheitlicher Erfolg 202 in `app/api/waitlist/route.ts:45`; HTTP-Test `scripts/verify-waitlist.ts:20-33` |
| `/r/:token` | GET | Capability-Token; kein Login | 60/min/IP | begrenzte DB-Reads; `media` lädt nur gespeicherte, SSRF-geprüfte Bildquelle | in Ordnung als bewusst öffentliche Freigabestrecke; zufälliger 32-Byte-Token, 404 für ungültig, kein Stacktrace | `app/r/[token]/route.ts:18-27`; `lib/approvals.ts:20-41`; `app/r/[token]/media.ts:17-43` | keine |
| `/r/:token` | POST | Capability-Token + Same-Origin/Fetch-Site | 60/min/IP und 10 Entscheidungen/h/(Token, IP) | DB-Entscheidung + Outbox, kein unmittelbarer Provider-Aufruf | in Ordnung | `app/r/[token]/route.ts:29-42`; `app/r/[token]/actions.ts:5-16`; `lib/approvals.ts:46-85` | keine |
| `/m/:id` | GET | öffentliche Capability-URL | 300/min/IP | DB-Read + gespeicherte Bytes; keine Verarbeitung/kein ausgehender Aufruf; ID exakt 43 Zeichen | in Ordnung: `Content-Length`, MIME, ETag; 404/410 unterscheidet Tombstone, bewusstes Lösch-/Cache-Verhalten | `app/m/[id]/route.ts:7-22`; `scripts/verify-media.ts` 304/410-Prüfungen | keine |
| `/healthz` | GET | anonym | 60/min/IP; 2-s Timeout | eine begrenzte Migrations-/Worker-Abfrage | in Ordnung für den dokumentierten Healthcheck; gibt absichtlich Version/Migrationsstand/Workerzustand preis, aber keine Kundendaten | `app/healthz/route.ts:9-22`; `README.md:571-584` | offen: falls Infrastrukturdetails nicht öffentlich sein sollen, getrennten internen Readiness-Endpunkt einführen; öffentliches Healthcheck-Verhalten würde sich ändern |
| `/join/:token` | GET | anonymes Anzeigen; Annahme später Sitzung | 30/min/IP via Proxy | eine tokengebundene Invite-DB-Abfrage; keine Mail/Provider-Wirkung | in Ordnung: 43-Zeichen-Token, kein Workspace bei ungültigem Token; abgelaufene/revozierte Einladungen zeigen absichtlich den Status | `proxy.ts:46-49`; `lib/team.ts:8-20`; `app/join/[token]/page.tsx:11-17` | keine |
| `/login`, `/login/check-email` | GET; Server Actions POST | anonym | Login-Action 10/min/IP; Mail zusätzlich 3/15min/Empfänger und 10/h/IP | begrenzte Auth-Mail; Funnel-DB-Schreibungen jetzt vorab begrenzt; Check-E-Mail zeigt nur vom Nutzer selbst übergebene Adresse | in Ordnung nach Reparatur | `app/login/page.tsx:14-39`; `app/login/check-email/page.tsx:8-15`; `lib/auth-email.ts:23-53` | siehe Auth-Reparatur |
| Öffentliche Seiten `/`, `/pricing`, `/roadmap`, `/compare`, `/compare/:slug`, `/docs`, `/docs/:slug`, `/docs/api`, `/impressum`, `/privacy`, `/terms`, `/legal`, `/legal/dpa` | GET/HEAD | keine | öffentliche View-Messung mit Tages-Cap 50.000 pro Event/Prozess; sonst keine | SSR/DB nur für Inhalte und begrenzte Funnel-Messung; keine Mail/Stripe/Provider-Wirkung | in Ordnung: statische/gebundene Inhaltsmengen, escaped Markdown; Fehlerhülle; keine fremden Kundendaten | Seiten unter `app/{page,pricing,roadmap,compare,docs,impressum,privacy,terms,legal}/*`; `lib/funnel.ts:24-39`; `app/docs/_components/markdown.tsx:3` | keine |
| `/robots.txt` | GET | keine | Next statisch | keine | in Ordnung; verbietet `/api/`, `/app`, `/r/`, `/m/`, `/join/`, `/login`, `/healthz` | `app/robots.ts:1-3` | keine |
| `/sitemap.xml` | GET | keine | Next statisch; feste Liste aus Help-/Compare-Inhalten | keine DB-/Provider-Wirkung | in Ordnung; keine privaten Pfade | `app/sitemap.ts:5-7` | keine |
| `/icon.svg`, `/opengraph-image` | GET | keine | Next/static asset serving | keine | in Ordnung: statische Build-Assets, keine Nutzerdaten | `app/icon.svg`, `app/opengraph-image.tsx:1-8` | keine |
| `/app/**` und `/app` | GET/POST/Server Actions | Sitzung bzw. Proxy-Redirect; anonyme Nutzer werden auf `/login` geleitet | geschützte Aktionen haben Session-Budget 120/min und Action-Body-Limits | in Ordnung: kein anonymer Workspace-/Kundendatenzugriff; die vollständige geschützte Fläche ist nicht öffentliche Angriffsfläche | `app/app/layout.tsx:22-31,64-101`; `lib/core.ts:10-21`; `proxy.ts:50-65` | keine |

## Bewertungsdetails

- Anfragegrößen: JSON 64 KiB, Bulk 2 MiB, Stripe-Webhook 512 KiB, Formulare
  standardmäßig 64 KiB; `readBody` begrenzt auch Streams und bricht nach 10 s
  ab (`lib/http/body.ts:6-40`). Bilduploads haben separate Sharp-/Byte-/Pixel-
  Grenzen (`lib/media/request.ts:9-24`, `lib/media/image.ts`).
- Rückgabemengen: API-Pagination/Limit ist gebunden; öffentliche Approval-
  Antworten enthalten nur sichtbare Post-/Target-Felder und keine interne ID
  (`lib/approvals.ts:24-41`); Healthz ist die einzige absichtlich informative
  Diagnoseantwort.
- Interne Fehler: `apiError` liefert für unbekannte Fehler ausschließlich
  `internal_error` und eine Request-ID, während sichere Validierungsfehler
  explizit erlaubt sind (`lib/api/errors.ts:9-19`). Webhook-, Waitlist-, OAuth-
  und Billing-Routen haben zusätzliche generische Hüllen.
- Kosten-/Netzwerkpfade: Stripe, SMTP, OAuth und Publishing sind jeweils hinter
  Sitzung/Signatur/Secret; öffentliche `/r`-Medien akzeptieren nur erlaubte
  HTTPS-Bildadressen und blockieren private/Loopback-Ziele
  (`app/r/[token]/media.ts:17-43`).

## Reparatur-Nachweis

Vorher (gegen `main`/`efd05ab`, erwartetes Rot):

```text
login guard test rc=1
waitlist uniform-status test rc=1
```

Nachher:

```text
✔ public login action is guarded before funnel recording
✔ waitlist success responses do not enumerate duplicate emails
ℹ pass 2
```

Die DB-/HTTP-Regressionen liefen in der isolierten Verify-Datenbank. Die
Sign-in-Tests meldeten `# tests 3`, `# pass 3`; die Waitlist-Prüfung meldete:
`PASS: uniform 202 success, invalid 422, eleventh registration 429, proxy spoof resistance, persisted rows`.

## GELIEFERT

- Öffentliche Endpunktaufnahme und Bewertung oben, mit Datei-/Zeilenbelegen.
- Login-Action-Rate-Limit vor Funnel-DB-Schreibzugriff.
- Einheitlicher Waitlist-Erfolgscode zur Vermeidung der E-Mail-Enumeration.
- Tests und Report in diesem Worktree.

## VERIFIZIERT WIE

- `npx tsc --noEmit` — rc=0.
- `npm run build` — erfolgreich.
- `npm run verify:all` — `PASS verify:all`.
- `npm run verify:http` — `PASS verify:http`; die Suite bestätigte u.a.
  `PASS /healthz: 200`, `PASS /login: 200`, Waitlist, Approval, Media und
  C7-HTTP-Smoke isoliert.

## OFFEN

- `/healthz` exponiert weiterhin absichtlich Version, Migrationsstand und
  Worker-Alter. Das ist für den aktuellen öffentlichen Infrastruktur-Healthcheck
  dokumentiertes Verhalten; Änderung nur mit internem Readiness-Endpunkt und
  Anpassung der Betriebsabfrage.
- `GET /r/:token` und `GET /m/:id` unterscheiden gültige/ungültige bzw.
  tombstoned Capabilities. Das ist für Freigabelinks, Cache und Löschstatus
  funktional erforderlich; Token sind 32 Byte zufällig und nicht auffindbar.
