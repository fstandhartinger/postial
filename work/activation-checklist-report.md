# Activation checklist

## GELIEFERT

- Die Übersicht zeigt genau drei zustandsgetriebene Schritte: Brand anlegen, aktiven Kanal verbinden und ersten Beitrag planen.
- Die Zustände werden direkt aus den Workspace-Datenbankzeilen für `brands`, `channels.status` und `posts` gelesen. Es gibt keine gespeicherte Onboarding-Progression und keine Progressbar.
- Offene Schritte verlinken jeweils mit einem Klick auf `/app/brands`, den ersten Brand mit `#connect` oder `/app/posts/new`. Jeder Schritt zeigt den Textstatus `Done` oder `Open`; bei 3/3 wird die Liste nicht gerendert.
- Browser-Guards in `verify-appshell.ts` und `verify-fixer3-browser.ts` wurden auf die neue 3-Schritt-Semantik aktualisiert. Keine Änderungen an Auth, Billing, Publishern oder Leerzuständen.

## VERIFIZIERT WIE

- `npx tsx scripts/verify-activation-checklist.ts`: PASS. Frischer Fixture-User; 3 offene Schritte und Ziel-Links geprüft, danach Brand, aktiver synthetischer Kanal und Beitrag lokal in der DB angelegt; Statuswechsel und dauerhaft ausgeblendete Liste geprüft.
- Screenshots: `work/activation-evidence/01-fresh-open-{390,1280}.png`, `02-brand-done-{390,1280}.png`, `03-channel-done-{390,1280}.png`, `04-complete-hidden-{390,1280}.png`.
- `npx tsc --noEmit`: rc=0.
- `npm run build`: rc=0.
- `npm run verify:all`: PASS verify:all.
- `npm run verify:http`: PASS verify:http; Browser-Prüfungen liefen sequenziell und vollständig durch, inklusive 390/1280 Overflow- und Accessibility-Checks.

## OFFEN

- Nichts im beauftragten Umfang.
