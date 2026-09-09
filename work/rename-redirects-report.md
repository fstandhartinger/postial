# Host-Umleitungen fuer Postial

## GELIEFERT

- Kanonische Redirect-Ziel-Origin ist `NEXT_PUBLIC_APP_URL`.
- `REDIRECT_HOSTS` konfiguriert die kommagetrennte Hostliste; Standard sind `www.postial.co`, `postial.net` und `www.postial.net`.
- `socialmint.app.mintapis.com` bleibt ueber `LEGACY_HOST_REDIRECT=1` opt-in.
- `/healthz` wird unabhaengig vom Host nie umgeleitet.
- Permanente Redirects verwenden waehrend der Umschaltphase `Cache-Control: max-age=300`.
- HSTS bleibt in `next.config.ts` unveraendert.
- Metadata-Canonicals, Sitemap und Robots verwenden weiterhin die Env-basierte `NEXT_PUBLIC_APP_URL`-Origin und nicht den Request-Host.

## VERIFIZIERT WIE

- `npm run lint`
- `npx tsc --noEmit`
- `npm run build`
- Standalone-Hostmatrix mit `NEXT_PUBLIC_APP_URL=https://postial.co`: Redirects fuer `www.postial.co`, `postial.net` und `www.postial.net`, direkte 200-Antwort fuer `postial.co`, Legacy-Host ohne Schalter 200 und mit `LEGACY_HOST_REDIRECT=1` 301, `/healthz` immer 200.
- `npm run verify:all`
- `git diff --check`

## OFFEN

- Keine Code-seitigen Punkte offen. DNS-/Proxy-Umschaltung bleibt Deployment-Konfiguration.
