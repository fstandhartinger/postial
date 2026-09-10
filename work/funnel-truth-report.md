# Funnel truth report

## Ergebnis

Der echte Browser-Weg erzeugt in einer isolierten Datenbank die Kette lückenlos und je einmal. Der Formularpfad zum Kanalverbinden hatte zuvor kein `channel_connected`; das wurde minimal ergänzt und nur beim erstmaligen Einfügen eines Kanals ausgelöst. Reconnect/Update erzeugt damit kein zweites Funnel-Ereignis.

| Schritt | erwartetes Ereignis | tatsächlich | Bewertung | Korrektur |
|---|---|---|---|---|
| Startseite | `landing_view` | 1 | PASS | keine |
| Preisseite | `pricing_view` | 1 | PASS | keine |
| Magic-Link-Formular absenden | `signup_started` | 1 | PASS | keine |
| Magic Link einlösen | `signup_completed` | 1 | PASS | keine |
| App-Erstzugriff | `workspace_created` | 1, richtige Workspace-ID | PASS | keine |
| Marke anlegen / Kanalformular absenden | `channel_connected` | 1, richtige Workspace-ID | PASS nach Korrektur | `app/app/actions.ts`: Event nach erfolgreichem Insert |
| Beitrag planen | `post_scheduled` | 1, richtige Workspace-ID | PASS | keine |
| Beitrag veröffentlichen (Provider-Attrappe) | `post_published` | 1, richtige Workspace-ID | PASS | keine |

Der neue Browser-Regresstest ist `scripts/verify-funnel-browser.ts`; ohne die Korrektur schlägt er am Kanal-Schritt fehl, weil der Formularpfad kein `channel_connected` schreibt.

## Readout-Fallen

- Fünf Reloads der Startseite erzeugen fünf `landing_view`-Rows (die technische Messung zählt Seitenaufrufe, nicht eindeutige Menschen). Das ist als Traffic-/View-Zahl korrekt, aber als Zahl „Menschen im Funnel“ irreführend. Das Admin-Readout benennt die Darstellung deshalb ausdrücklich als „raw event counts“; die Zahl wurde nicht verfälscht.
- Ein abgebrochener Signup lässt `signup_started` ohne `signup_completed` stehen. Das ist der ehrliche Zustand: Die Rate fällt, und der Readout stellt keinen Abschluss her, der nicht stattgefunden hat. Die Konversionsrate wird aus den Rohereignissen der jeweils vorherigen Stufe berechnet.

## Verifikation

- `npx tsc --noEmit`: rc 0
- `npm run build`: erfolgreich
- `npm run verify:all`: `PASS verify:all`
- `npm run verify:http`: `PASS verify:http`
- Browser-Regresstest: `PASS funnel browser journey: eight events exactly once`
- Keine Produktionsdatenbank, echten Mails oder externen Provider verwendet; der Lauf nutzte die isolierte Suite-Datenbank und eine lokale Provider-Attrappe.

## GELIEFERT / VERIFIZIERT WIE / OFFEN

**GELIEFERT:** Minimaler Funnel-Fix für das UI-Kanalformular, Browser-End-to-End-Regresstest und dieser Bericht.

**VERIFIZIERT WIE:** Isolierte `verify-suite`-DB, echter Chromium-Browser, UI-Schritte, DB-Abgleich nach den Stufen, vollständige TypeScript-, Build-, DB- und HTTP-Verifier.

**OFFEN:** Keine technische Abweichung. `landing_view` bleibt bewusst eine View-Metrik und kein Unique-User-Zähler.
