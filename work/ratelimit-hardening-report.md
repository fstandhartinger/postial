# Ratenlimit-Härtung

## GELIEFERT

- Nicht identifizierbare Gegenstellen verwenden keine enge gemeinsame Nutzergrenze mehr. `trustedClientIp` akzeptiert `x-real-ip`, sonst den rechtesten `x-forwarded-for`-Hop ausschließlich bei `APPROVAL_TRUST_PROXY=true`; andernfalls bleibt die Identität `untrusted-peer`. Für unbekannten Verkehr gelten die benannten Konstanten `UNIDENTIFIED_TRAFFIC_RATE_LIMIT=200` und `UNIDENTIFIED_TRAFFIC_RATE_WINDOW_SECONDS=3600` als Notbremse. Bekannte Waitlist-Gegenstellen bleiben bei 10/Stunde.
- Überschrittene Login-Server-Action leitet auf die reguläre Check-Email-Seite mit neutralem Hinweis weiter.
- Jede valide Waitlist-Einsendung, einschließlich Duplikaten, verbraucht einen Versuch. Duplikate bleiben auch an der Grenze als generische 202-Antwort nicht unterscheidbar.
- Stripe-Portal-Idempotenz ist an Workspace und Stripe-Kunde gebunden und nutzt ein 10-Sekunden-Fenster.

## VERIFIZIERT WIE

Vorher gegen `main` reproduziert:

```text
P1 BEFORE: FAIL (expected regression reproduced)
P2 BEFORE: FAIL (expected regression reproduced)
P3 BEFORE: FAIL (expected regression reproduced)
P4 BEFORE: FAIL (expected regression reproduced)
```

Nachher:

```text
4 sign-in-ratelimit tests: PASS
  unidentified traffic ... emergency brake: PASS
  send-in mail ... caller response: PASS
waitlist: valid duplicates consume quota ...: PASS
double-fire guards ...: PASS
verify:all: PASS
verify:http: PASS
npx tsc --noEmit: rc=0
npm run build: successful
```

Die Tests verwenden ausschließlich die isolierte Verify-Datenbank, Mail-Attrappen und Stripe-Attrappen; es gab keine Produktionsanfragen, Produktionsdatenbankzugriffe oder echten Mails.

## OFFEN

- Keine anbieterspezifische Punkt-/Plus-Kanonisierung von Empfängeradressen. Das Verhalten bleibt bewusst unverändert: solche Regeln sind fehleranfällig und könnten legitime Adressen treffen. Die Empfängergrenze zusammen mit der 200/Stunde-Notbremse für nicht identifizierbaren Verkehr deckt den relevanten Missbrauch ab.
