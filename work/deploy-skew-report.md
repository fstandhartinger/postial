# Deployment-versatz

## GELIEFERT

- Die konkrete Next.js-Meldung „Failed to find Server Action“ wird als `DeploymentSkewError` klassifiziert.
- Betroffene Menschen sehen eine ruhige, fachbegriffsfreie Meldung: Die Anwendung wurde aktualisiert; einmal „Reload page“ ausführen; die Eingaben sind weiterhin da. Es gibt genau diese eine Handlung, kein automatisches Neuladen und keine Schleife. Keine Stapelspur wird angezeigt.
- `error_events.error_class` ist für diesen Fall `DeploymentSkewError`; Redaction und Bereinigungsregeln bleiben unverändert.
- `next.config.ts` nutzt die dokumentierte Next.js-Option `deploymentId` über `NEXT_DEPLOYMENT_ID`, `DEPLOYMENT_VERSION` oder `GIT_SHA`.
- Keine Abrechnungs-, Authentifizierungs- oder Publisher-Logik wurde geändert.

## VERIFIZIERT WIE

- Neuer Test `scripts/verify-deployment-skew.tsx`: eigene Aussage, keine Stapelspur, genau eine Neulade-Aktion und unterscheidbare `error_events`-Klasse.
- `npx tsc --noEmit` — PASS.
- `npm run build` — PASS.
- `/home/flori/ventures2/socialmint/ops/run-verification.sh npm run verify:all` — PASS verify:all.
- `/home/flori/ventures2/socialmint/ops/run-verification.sh npm run verify:http` — PASS verify:http; Browser-Suites vollständig beendet.

## OFFEN

- Die Konfiguration schützt nur dann aktiv gegen Versatz, wenn die Ausbringungsumgebung eine pro Ausbringung eindeutige Kennung in einer der drei Variablen setzt. Das Ausbringungsverfahren wurde nicht geändert; die vorhandene Umgebung muss diese Kennung liefern bzw. `GIT_SHA` verfügbar machen.
