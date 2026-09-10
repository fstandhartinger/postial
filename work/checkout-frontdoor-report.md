# Postial Checkout Frontdoor

## GELIEFERT

Isolierter Browserlauf über Pricing → App → Billing → Stripe Test-Checkout sowie Portalprüfung. Es wurde keine Zahlung abgeschlossen und kein Formular abgesendet.

## VERIFIZIERT WIE

| Schritt | beobachtet | Bewertung | Korrektur |
|---|---|---|---|
| Kundenportal ohne Abonnement | 404 mit verständlichem „Billing customer not found“ statt Portalzugang | PASS | keine |
| Preisseite 390px | Starter/Agency, EUR-Preise und eindeutige Start-Buttons sichtbar | PASS | keine |
| App 390px | App nach Anmeldung erreichbar; Billing-Navigation vorhanden | PASS | keine |
| Billing 390px | Planwahl und Start-14-day-free-trial eindeutig | PASS | keine |
| Preisseite 1280px | Starter/Agency, EUR-Preise und eindeutige Start-Buttons sichtbar | PASS | keine |
| App 1280px | App nach Anmeldung erreichbar; Billing-Navigation vorhanden | PASS | keine |
| Billing 1280px | Planwahl und Start-14-day-free-trial eindeutig | PASS | keine |
| Gehosteter Stripe-Checkout | Gültige checkout.stripe.com-Adresse lädt; EUR 19 und Produktname sichtbar; keine Zahlung/Kartendaten/Absenden | PASS | keine |
| Abbruch-Rückweg | Cancel-URL führt zu /pricing?checkout=cancelled und ist verständlich | PASS | keine |
| Erfolgsadresse ohne Zahlung | Nur Hinweis auf ausstehende Zahlungsbestätigung; kein active/trialing-Zugang | PASS | keine |
| Kundenportal mit Testkunde | Gültige billing.stripe.com-Adresse und Test-Portal-Konfiguration | PASS | keine |

Alle Stripe-Objekte wurden mit livemode:false geprüft. Der Checkout blieb offen; die Success-URL wurde nur ohne Zahlung aufgerufen und gewährte keinen active/trialing-Zugang. Doppelklick: der zweite parallele Aufruf lieferte höchstens eine wiederverwendete Session bzw. 409, keine zweite aktive Session. Screenshots liegen unter [work/frontdoor-evidence](work/frontdoor-evidence/).

Aufräumnachweis: Test-Produkt archiviert, beide Test-Preise deaktiviert, Testkunde gelöscht, offene Checkout-Session abgelaufen, isolierte Datenbank und Schema entfernt. Nachher erneut aufgelistet: `products=0 customers=0 active_prices=0 open_checkout=0` für diesen Lauf.

## OFFEN

Kein echter Zahlungsvorgang und keine Produktions-Webhook-Zustellung wurden geprüft; beides war aus Sicherheitsgründen ausdrücklich ausgeschlossen.
