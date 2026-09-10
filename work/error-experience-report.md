# Error experience report

## GELIEFERT

- Branded root, global, app error and not-found boundaries with honest copy, one primary next step, accessible alert semantics, short optional reference, and Impressum contact.
- Approval links now explain that an unavailable link may be incorrect, expired, or already used without guessing which.
- Publishing, channel connection, billing and generic action failures now include a concrete next step or an honest support route.

| Fehlerfall | bisherige Meldung | was der Nutzer tun kann | neue Meldung |
|---|---|---|---|
| Fehlgeschlagene Veröffentlichung | `Failed.` / provider human message only | Review the channel message and retry when ready | `Publishing did not finish for one or more channels. Review the channel messages below and retry when you are ready.` |
| Abgelaufener/ungültiger Freigabelink | `Page not found` / `This page is unavailable.` | Ask the sender for a new link | `This approval link is no longer available. This link may be incorrect, expired, or already used. We cannot tell which from here. Ask the sender for a new link.` |
| Kanalverbindung fehlgeschlagen | `The provider could not complete the connection. Please try Connect again shortly.` | Try Connect again; contact support if it still fails | `The connection did not finish. We do not know why yet. Try Connect again shortly. If it still fails, email info@productivity-boost.com.` |
| Zahlung fehlgeschlagen | `Unable to start checkout` / `Unable to open billing` | Try again; contact support if it still fails | `We couldn’t start/open billing. Try again. If it still fails, contact support.` |
| Fehlende Berechtigung | Generic action failure | Try again; contact support if persistent | `We couldn’t complete that action. We do not know why yet. Please try again. If it still fails, contact info@productivity-boost.com.` |

## VERIFIZIERT WIE

- `npx tsc --noEmit` — rc=0.
- `npm run build` — successful production compilation; `.next/BUILD_ID` present.
- `npm run verify:http` — `PASS verify:http`.
- `npm run verify:all` — `PASS verify:all` (rc=0).
- Browser test forced `GET /this-route-does-not-exist` at 390 and 1280 px: HTTP 404, branded message present, at least one alert region, exactly one primary navigation CTA, no stack trace text, and `document.documentElement.scrollWidth <= innerWidth`.
- Screenshots: `work/error-ux-evidence/not-found-390.png` and `work/error-ux-evidence/not-found-1280.png`.

## OFFEN

- No production data, provider login, push, or deploy was performed.
