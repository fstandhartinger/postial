# Trial clarity audit

## Tatsächliche Fakten aus dem Code

| Fakt | Beleg |
|---|---|
| Trial: 14 Tage; Checkout sammelt im Trial keine Zahlungsmethode zwingend; fehlt sie am Ende, wird die Subscription beendet | [`lib/plans.ts:1`](/tmp/postial-trial/lib/plans.ts:1), [`lib/checkout-trial.ts:2-6`](/tmp/postial-trial/lib/checkout-trial.ts:2), [`app/api/stripe/checkout/route.ts:54-67`](/tmp/postial-trial/app/api/stripe/checkout/route.ts:54) |
| Trial nur einmal pro Workspace; ein späterer Checkout ist ohne Trial und verlangt eine Zahlungsmethode | [`app/api/stripe/checkout/route.ts:53-55`](/tmp/postial-trial/app/api/stripe/checkout/route.ts:53), [`lib/checkout-trial.ts:4-6`](/tmp/postial-trial/lib/checkout-trial.ts:4) |
| Starter: 19 €/Monat, 3 Marken, 1 Sitz, 200 MiB, keine Approval-Links | [`lib/plans.ts:8`](/tmp/postial-trial/lib/plans.ts:8), [`lib/entitlements.ts:23-25`](/tmp/postial-trial/lib/entitlements.ts:23) |
| Agency: 49 €/Monat, 15 Marken, 5 Sitze, 2 GiB, Approval-Links, Agency-API | [`lib/plans.ts:9`](/tmp/postial-trial/lib/plans.ts:9), [`lib/entitlements.ts:23-25`](/tmp/postial-trial/lib/entitlements.ts:23) |
| Nach Ablauf ohne gültigen Zugriff: Publishing aus; Starter-Fallback bleibt bei 3 Marken/1 Sitz/200 MiB, vorhandene Inhalte können gelesen werden; bezahlte Zugriffe prüfen das Periodenende | [`lib/entitlements.ts:8-25`](/tmp/postial-trial/lib/entitlements.ts:8), [`content/help/billing.md:19`](/tmp/postial-trial/content/help/billing.md:19) |
| Kündigung: über Stripe Customer Portal; bezahlter Zugriff läuft bis zum Ende der aktuellen Periode; Workspace-Löschung kündigt sofort | [`app/api/stripe/portal/route.ts:1-80`](/tmp/postial-trial/app/api/stripe/portal/route.ts:1), [`content/help/billing.md:11-17`](/tmp/postial-trial/content/help/billing.md:11) |
| Verbundbare Provider/Adapter: Bluesky, Mastodon, Telegram sowie X, Threads und LinkedIn; OAuth-Provider werden nur bei konfigurierten Credentials angeboten | [`lib/publishers/types.ts:6`](/tmp/postial-trial/lib/publishers/types.ts:6), [`lib/publishers/index.ts:21-34`](/tmp/postial-trial/lib/publishers/index.ts:21), [`lib/publishers/index.ts:17-19`](/tmp/postial-trial/lib/publishers/index.ts:17) |

## Öffentliche Aussagen, Abgleich und Korrekturen

| Aussage | Fundort (Datei:Zeile) | tatsächlicher Beleg (Datei:Zeile) | Urteil | Korrektur |
|---|---|---|---|---|
| Starter kostet 19 €/Monat; Agency 49 €/Monat | `content/landing.json:251,301`; `content/compare.json:6-7`; `app/compare/[slug]/page.tsx:52`; `/pricing` über `components/marketing/Plans.tsx:7-21` | `lib/plans.ts:3-4,8-9` | Richtig; unverändert | Pricing-Komponente leitet die angezeigten Preise jetzt direkt aus `plans` ab. |
| Starter 3 Marken/1 User; Agency 15 Marken/5 User | `content/landing.json:263,313-317`; `content/compare.json:6-7`; `content/help/brands.md:13`; `content/help/team.md:14` | `lib/plans.ts:8-9`; `lib/entitlements.ts:23-25` | Richtig; gegen Drift abgesichert | `/pricing` rendert Marken/Sitze aus `plans`. |
| Speicher beträgt 200 MiB/2 GiB | `content/help/uploads.md:14` | `lib/plans.ts:8-9`; `lib/entitlements.ts:25` | Bisher fehlte die Aussage auf `/pricing` | `/pricing` zeigt die aus `plans` abgeleitete Speichergrenze. |
| Approval-Links sind Agency-only, ohne Client-Login und ohne Sitzverbrauch | `content/availability.json:34`; `content/landing.json:325,377`; `content/help/approvals.md:3,7,14`; `content/help/faq.md:15-17` | `lib/plans.ts:8-9`; `lib/entitlements.ts:25` | Richtig | Unverändert. |
| 14 Tage, keine Karte; bei Nichtstun keine Abbuchung/automatisches Ende | `app/pricing/page.tsx:11-12`; `content/landing.json:347,403,411`; `content/compare.json:13,31-32,91,118`; `content/help/billing.md:8-15`; `content/help/faq.md:11-13` | `lib/plans.ts:1`; `lib/checkout-trial.ts:4-6`; `app/api/stripe/checkout/route.ts:54-67` | Richtig und jetzt auf `/pricing` explizit | Pricing notes nennen zusätzlich explizit Stripe-Cancel und keine Abbuchung bei fehlender Zahlungsmethode. |
| Zahlung nach Trial durch Zahlungsmethode im Portal; monatliche Verlängerung; Kündigung im Portal, Zugriff bis Periodenende | `content/landing.json:347,419`; `content/help/billing.md:10-17`; `content/terms.json` Abschnitt 3-4 | `lib/checkout-trial.ts:4-6`; `app/api/stripe/portal/route.ts:1-80` | Belegt und ausreichend | Auf `/pricing` ist der Ablauf jetzt zusätzlich direkt beim Preis erklärt. |
| Live-Provider Bluesky, Mastodon, Telegram; X/Threads/LinkedIn Early access; Instagram/Facebook geplant | `components/marketing/NetworkAvailability.tsx:6-18`; `content/availability.json:11-19,38-85`; `app/roadmap/page.tsx:5-8`; `content/help/channels.md:14`; `content/help/faq.md:23-25` | `lib/publishers/types.ts:6`; `lib/publishers/index.ts:21-34`; `content/availability.json:38-85` | Provider-Aussagen konsistent; nicht geändert | Unverändert gemäß Auftrag. |
| Native n8n-Paket `n8n-nodes-socialmint` sei bereits auf npm | Vorher: `content/landing.json:67,165,385,451`; `content/availability.json:19`; `content/compare.json:10,97,216`; `app/docs/api/page.tsx:20,67` | Gegenbeleg: `content/help/n8n.md:21-23` sagt ausdrücklich, dass `n8n-nodes-postial` noch nicht veröffentlicht ist; API/Webhooks sind belegt durch `content/help/api-webhooks.md:3-17` | Falsch/veraltet und widersprüchlich | Landing, Availability, Comparisons und API-Doku sagen nun: native Postial-n8n-Paket noch nicht veröffentlicht; HTTP Request/Webhook mit Agency-API verwenden. |
| API/Webhooks sind Agency-only | `content/landing.json:287,385,451`; `content/compare.json:8,10`; `content/help/api-webhooks.md:7,15` | `lib/entitlements.ts:25`; `lib/api/auth.ts:16` | Richtig | Unverändert; n8n-Nutzung klar auf den belegten HTTP-Weg begrenzt. |
| German hosting / App-Daten in Deutschland | `content/compare.json:12,97,199`; `content/landing.json:443`; `content/help/uploads.md:16` | Im Anwendungscode kein Hosting-Ort; Beleg in `content/privacy.json` und `content/terms.json` | Belegt durch veröffentlichte Datenschutz-/Terms-Dokumente, nicht durch Laufzeitcode | Unverändert; kein stärkerer Code-Beleg behauptet. |
| Vergleichsanbieterpreise und -funktionen | `content/compare.json:47-235` | Verlinkte Quellen und Abrufdaten im selben JSON (`content/compare.json:121-235`) | Fremdanbieter-Aussagen, nicht aus Postial-Code ableitbar; als Quellenbehauptungen gekennzeichnet | Unverändert; keine neue Gleichwertigkeits- oder Sparbehauptung ergänzt. |

Die wiederholten Vorkommen in `/compare/*` werden aus `content/compare.json` gerendert; die gemeinsame CTA-/Trial-Zeile steht in `app/compare/[slug]/page.tsx:50-52`. `/docs` rendert die Markdown-Artikel aus `content/help/*.md` über `app/docs/(help)/[slug]/page.tsx:15-20`; die Billing-, Plan-, Trial-, Kündigungs-, Speicher- und Provider-Aussagen dort sind oben inventarisiert. `/roadmap` verwendet dieselbe Availability-Matrix wie `/pricing` (`app/roadmap/page.tsx:8`, `components/marketing/NetworkAvailability.tsx:8-12`).

## GELIEFERT

- Öffentliche Plananzeige gegen `lib/plans.ts` entkoppelt: Preise, Marken, Sitze und Speicher werden aus der zentralen Planquelle gerendert.
- Trial-/Kündigungs-/Nichtstun-Hinweis auf `/pricing` vervollständigt.
- Widersprüchliche, unbelegte npm-n8n-Aussagen auf Startseite, Pricing-Shared-Copy und Comparisons korrigiert; Provider-Verfügbarkeit nicht verändert.
- Regressionstest `scripts/marketing-plans.test.ts` ergänzt.

## VERIFIZIERT WIE

- `node --import tsx --test scripts/marketing-plans.test.ts` — PASS (1/1).
- `npx tsc --noEmit` — PASS (rc 0).
- `npm run build` — PASS (rc 0), inklusive `postbuild`.
- `npm run verify:all` — PASS (rc 0).
- `npm run verify:http` — PASS (rc 0).

## OFFEN

- Keine Abweichung der Provider-Verfügbarkeitsaussagen festgestellt; sie wurden daher nicht angefasst.
- Hosting-Ort und Fremdanbieter-Vergleichsdaten sind öffentliche Dokument-/Quellenangaben, nicht aus `lib/plans.ts` oder der Billing-Laufzeit ableitbar.
- Keine offenen technischen Blocker für diesen Audit-Branch.
