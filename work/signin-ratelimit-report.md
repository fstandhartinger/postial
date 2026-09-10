# Sign-in rate-limit verification

## GELIEFERT

- `sendPostialVerificationRequest` prüft vor `sendMail` zwei atomare Fixed-Window-Limits in `request_rate_limits`:
  - normalisierte Empfängeradresse: 3 / 15 Minuten (`lib/auth-email.ts:7-8,25-35`)
  - normalisierte Client-IP: 10 / 60 Minuten (`lib/auth-email.ts:9-10,27-30`)
- Die Client-IP folgt exakt dem vorhandenen Proxy-Vertrag `APPROVAL_TRUST_PROXY` + `x-real-ip` und fällt sonst auf `untrusted-peer` zurück (`lib/rate-limit.ts:23-27`).
- Überschreitungen liefern still `void`; Auth.js behält damit die normale Bestätigungsantwort. Es wird keine Mail gesendet. Das Log enthält nur Scope, Domain und einen 12-stelligen HMAC-Präfix (`lib/auth-email.ts:31-35`). Token und vollständige Adresse werden nicht geloggt.
- Weitere Mailversandpfade wurden per Suche geprüft: der einzige SMTP-Versand ist `lib/auth-email.ts:42-45`. Alert-/Freigabe-Benachrichtigungen werden als interne Benachrichtigungen bzw. durable Webhook-Outbox erzeugt; `testAlert` ist bereits auf eine Anfrage pro Minute begrenzt (`lib/notifications.ts:55-65`). Die teuren API-/Session-/öffentlichen Pfade verwenden bestehende Limits.

## VERIFIZIERT WIE

- `npx tsc --noEmit` → `rc=0`
- `npm run build` → Next.js Build erfolgreich, TypeScript-Phase erfolgreich
- `npm run verify:all` → `PASS verify:all`
- `npm run verify:http` → `PASS verify:http`
- Neuer isolierter Test `scripts/verify-signin-ratelimit.ts`, in `verify:all` aufgenommen:
  - vier gleiche Empfängeranfragen: genau 3 Attrappen-Versandaufrufe; vierte Anfrage ohne Versand; alle vier simulierten Antworten `302` mit identischem `/login/check-email`-Ziel
  - 11 verschiedene Empfänger von derselben Gegenstelle: genau 10 Versandaufrufe
  - abgelaufene Fixed Windows: Versand funktioniert wieder
  - Testdatenbank und Mailtransport sind Attrappen/isoliert; keine echten Mails und keine Produktionsdatenbank verwendet

## OFFEN

- Nichts.
