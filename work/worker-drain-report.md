# Worker-Drain-Prüfung

## Ergebnis

| Szenario | beobachtetes Verhalten | Datei:Zeile | Bewertung | Reparatur |
|---|---|---|---|---|
| 1. Prozessabbruch nach Claim | Nach SIGKILL: `post_targets.status=publishing`, `attempts=1`; nach Neustart und abgelaufener Lease: `needs_review`, Provider-Aufrufe `1` | `scripts/verify-worker-drain.ts:37-45` | Lücke (vorher automatische Wiederaufnahme möglich) | Ablauf wird als unklar behandelt; keine automatische Wiederholung |
| 2. Doppelversand | Vorher konnte der alte Prozess nach Provider-Annahme weiterlaufen, während Recovery neu claimte; damit wären zwei Aufrufe mit demselben Target möglich. Nachher: Provider-Aufrufe `1`, alte Antwort gefenced | `scripts/verify-worker-drain.ts:47-55`, `lib/publishing/index.ts:70-83` | Lücke behoben | `needs_review` bei Lease-Ablauf |
| 3. Lease läuft während Originalprozess | Zweiter Worker findet die abgelaufene Lease; Target wird `needs_review`, ein `recovered`-Event entsteht, Originalprozess wird beendet; kein zweiter Provider-Aufruf | `scripts/verify-worker-drain.ts:47-54` | Lücke behoben | Statusübergang stoppt Retry |
| 4. SIGTERM | Signal wird empfangen; aktiver Tick läuft bis zum Ergebnis; danach Exit. Testdauer < 5 s (Produktions-Hardlimit 95 s) | `scripts/verify-worker-drain.ts:57-63`, `lib/publishing/start.ts:13-37` | In Ordnung | Sauberes Drain mit 95-s-Hardlimit |

## Reparaturbeleg

Vorher war im bestehenden Commit-Outage-Test festgehalten, dass Mastodon/Bluesky nach verlorenem Ergebnis-Commit erneut aufgerufen werden (`remoteCalls=2` in `scripts/verify-core.ts`, ursprüngliche Erwartung). Das war der reproduzierte Doppelversandpfad: Provider nimmt an, Ergebnis-Commit fällt aus, Lease läuft ab, Recovery queued und ein zweiter Worker ruft erneut auf.

Nachher:

```
PASS 1: SIGKILL after claim preserves publishing lease; restart does not auto-republish
PASS 2/3: expired live lease is fenced and provider call count remains 1
PASS 4: SIGTERM waits for the active tick and exits after publish
```

Der Commit-Outage-Test wurde auf `needs_review`, `remoteCalls=1` und denselben Idempotenzschlüssel umgestellt; `verify:all` bestätigt diese Regressionstests.

## Verifikation

```
npx tsc --noEmit                 rc=0
npm run build                    rc=0
npm run verify:all               PASS verify:all
npm run verify:http              PASS verify:http
```

Alle Provider-Aufrufe im neuen Test sind registrierte In-Memory-Attrappen. Es gibt keine Netzwerkaufrufe zu sozialen Netzwerken, keine Produktionsdatenbank und keine echten Posts/Mails.

## GELIEFERT

- Isolierter Subprozess-/Datenbanktest für SIGKILL, Neustart, Doppelversand, abgelaufene Lease und SIGTERM-Drain.
- Minimaler Schutz gegen automatische Doppelveröffentlichung bei unklarem Lease-Ausgang.
- SIGTERM/SIGINT-Drain mit 95-Sekunden-Hardlimit.

## VERIFIZIERT WIE

- Dedicated `postial_verify_*` database via `scripts/isolated-db.mjs`, ohne `VERIFY_ALLOW_SHARED_DB`.
- `npx tsc --noEmit`, Build, `verify:all`, `verify:http` erfolgreich.

## OFFEN

- Ein harter Prozessabbruch unmittelbar nach Provider-Annahme bleibt fachlich unbestätigt und verlangt nun bewusst manuelle Prüfung; das ist der sichere Zustand gegen Doppelversand.
