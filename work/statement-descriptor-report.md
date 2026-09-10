# Statement-Descriptor- und Checkout-Prüfung

## GELIEFERT

Die Checkout-Strecke zeigt jetzt im Zahlmoment zwei ehrliche, knappe Hinweise auf Postial:

- Subscription-Beschreibung: `Postial social publishing subscription`
- Checkout-Submit-Hinweis: `Postial social publishing subscription.`

Ein Kontoauszug-Descriptor wurde nicht eingebaut: Die getestete Subscription-Checkout-API bietet dafür keinen gangbaren Parameter, und der Produkt-Descriptor wurde von Stripe nicht in die erzeugte Subscription-Rechnung übernommen.

| Weg | existiert? | Beleg (echte TEST-API-Antwort) | eingesetzt? |
|---|---|---|---|
| Checkout `payment_intent_data.statement_descriptor_suffix` | Nein für `mode=subscription` | `StripeInvalidRequestError`: `You can not pass \`payment_intent_data\` in \`subscription\` mode.` | Nein |
| Checkout `payment_intent_data.statement_descriptor` | Nein für `mode=subscription` | `StripeInvalidRequestError`: `You can not pass \`payment_intent_data\` in \`subscription\` mode.` | Nein |
| Checkout `subscription_data.statement_descriptor_suffix` | Nein | `parameter_unknown`, `subscription_data[statement_descriptor_suffix]`: `Received unknown parameter: subscription_data[statement_descriptor_suffix]` | Nein |
| Subscription `statement_descriptor_suffix` | Nein | `parameter_unknown`, `statement_descriptor_suffix`: `Received unknown parameter: statement_descriptor_suffix` | Nein |
| Invoice `statement_descriptor` | Ja, als Invoice-Feld | `in_1UE4ZdCozVR51OgarZXxHpmQ`, `livemode:false`, Antwort `statement_descriptor: POSTIAL SOCIAL` | Nein: eine Checkout-Subscription lässt dieses Feld nicht an der Session setzen; die automatisch erzeugte Trial-Rechnung hatte `statement_descriptor:null` |
| Invoice `statement_descriptor_suffix` | Nein | `parameter_unknown`, `statement_descriptor_suffix`: `Received unknown parameter: statement_descriptor_suffix. Did you mean statement_descriptor?` | Nein |
| Product `statement_descriptor` | Ja, als Product-Feld | Product-Update erfolgreich, `prod_VEXe0qdCeqp9lS`, `livemode:false`, Antwort `statement_descriptor: POSTIAL` | Nein: bei einer danach erzeugten Trial-Subscription-Rechnung blieb das Feld `null` |
| Price `statement_descriptor` | Nein | `parameter_unknown`, `statement_descriptor`: `Received unknown parameter: statement_descriptor` | Nein |
| Checkout `custom_text.submit.message` | Ja | Session `cs_test_a1Y0yCX1JsHIo1L3Hdlny8uTWoQ3scathL21wTKHZTjUkwmVNxUUzsyLQg`, `livemode:false`, Antwort enthält `submit.message: Postial social publishing subscription.` | Ja |
| Subscription `description` | Ja | Subscription `sub_1UE4ZcCozVR51OgaTpI3KSix`, `livemode:false`, `status:trialing`, Antwort `description: Postial social publishing subscription` | Ja |

Die verwendete Stripe-API-Version der echten Antworten war `2026-08-26.dahlia`. Produkt, Preis, Kunde, Checkout-Sessions, Trial-Subscription und Invoice wurden ausschließlich mit dem TEST-Schlüssel erzeugt. Keine Checkout-Session wurde abgeschlossen; offene Sessions wurden ablaufen gelassen.

## VERIFIZIERT WIE

- Der Schlüssel wurde ausschließlich aus dem laufenden Postial-Testcontainer gelesen, mit `sk_test_` geprüft und nie ausgegeben, gespeichert oder protokolliert.
- Jede erfolgreiche Stripe-Objektantwort wurde auf `livemode:false` geprüft. Die Stripe-Fehlerantworten enthalten selbst kein `livemode`-Feld; sie stammen aus denselben TEST-Anfragen und enthalten keine Live-Objekte.
- Nach jedem Experiment: offene Sessions abgelaufen, Subscription gekündigt, Kunde gelöscht, Price deaktiviert, Product deaktiviert.
- Nachbereinigung: `prod_VEXe0qdCeqp9lS` und `prod_VEXfP7pOVkriZ4` `livemode:false, active:false`; `price_1UE4ZaCozVR51OgauV31NgQT` `livemode:false, active:false`; Kundenantwort `deleted:true`. Keine der angelegten Sessions oder Subscriptions blieb aktiv.
- `npx tsc --noEmit`: rc=0.
- `npm run build`: erfolgreich.
- `npm run verify:all`: `PASS verify:all`.
- `npm run verify:http`: `PASS verify:http`.

## OFFEN

Der Händlername auf Kontoebene bleibt absichtlich unangetastet. Damit der Kontoauszug Postial eindeutig nennt, muss die Portfolio-Entscheidung im Stripe-Konto geändert werden: einen Postial-kompatiblen Statement Descriptor bzw. Händler-/Public-Business-Namen im passenden Stripe-Konto konfigurieren. Das ist außerhalb dieses Auftrags bewusst offen; die API-Experimente belegen, dass Checkout-Subscription, Subscription und Price hierfür keinen verwendbaren Weg bieten. Der Product- und Invoice-Weg existiert formal, beeinflusste in diesem Ablauf aber den tatsächlichen Subscription-Beleg nicht.

Commit: siehe finalen Handoff-Hash; lokaler Branch `fix/statement-descriptor`.
