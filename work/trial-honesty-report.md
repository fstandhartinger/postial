# Trial handoff honesty

## GELIEFERT

- Gemeinsame, nebenwirkungsfreie Trial-Eligibility-Prüfung in `lib/trial-eligibility.ts`.
- Continue-Seite zeigt für freien, verbrauchten und nicht bestätigbaren Trial ehrliche Varianten.
- `trialUsedAt` wird weiterhin ausschließlich in der Checkout-Route geschrieben.

## VERIFIZIERT WIE

- `scripts/verify-trial-handoff.tsx` prüft beide Varianten, den vorsichtigen Stripe-Fehlerfall und das Fehlen falscher Trial-/Karten-/später-Start-Zusagen im verbrauchten Fall.
- Vollständiger `npm run accept`-Lauf und Ergebnis stehen in `work/acceptance.json`.

## OFFEN

- Keine offenen Punkte.
