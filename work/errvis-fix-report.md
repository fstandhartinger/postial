# Error visibility hardening

## GELIEFERT

1. Persistierte Fehler enthalten nur eigene Metadaten und eine feste, erlaubte Meldung; freie Meldungen bleiben ausschließlich bereinigt im Containerlog. Der Testfall mit Adresse, Name und Beitragstext findet keinen dieser Werte in der Fehlerzeile.
2. Das Hourly-Cap wird pro Prozess vor jedem Datenbankzugriff gezählt; der unlimitierte `error_event_hourly`-Upsert ist entfernt.
3. Exporte laden höchstens 1.000 Medieneinträge und geben `mediaOmittedCount` aus.
4. Ausgelassene Medien enthalten keinen veralteten `/m/<id>`-Downloadweg mehr, sondern den ehrlichen Hinweis, sie vor dem Löschen einzeln zu laden. Das Löschverhalten blieb unverändert.
5. `errorsLastHour` ist aus `/healthz` entfernt.
6. Der Löschsweep prüft jede Testfallkennung spaltenweise über alle Tabellen und protokolliert Treffer samt Spalten.

## VERIFIZIERT WIE

Vorher (Baseline `00788b3`, reproduzierbare statische Negativbelege):

```text
35: ... message: details.message ...
37: const [counter] = await db.insert(errorEventHourly)...
40: ... message: details.message ...
```

Nachher:

```text
error visibility: API+worker, redaction, best-effort path, cap PASS
SWEEP fixture/export PASS
SWEEP workspace deletion PASS; funnel workspace_id=NULL; media bytes gone
SWEEP evidence written (36 tables)
PASS deletion sweep
PASS verify:all
PASS verify:http
```

Zusätzlich: `npx tsc --noEmit` rc=0 und `npm run build` erfolgreich. Der verschärfte Error-Test persistiert für den unauffälligen Testfall ausschließlich `[message omitted]`; die Logzeilen enthalten nur die bereinigte flüchtige Meldung und den Fingerabdruck.

## OFFEN

Keine offenen Punkte innerhalb dieses Arbeitsauftrags. Es gab keinen Push, Deploy oder Zugriff auf eine Produktionsdatenbank.
