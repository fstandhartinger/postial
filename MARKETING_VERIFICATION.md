# Milestone 1D — September 8, 2026

Delivered landing, pricing, client-side approval demo, shared responsive navigation/footer,
German imprint, privacy/terms, local Inter font (SIL license included), metadata,
SoftwareApplication JSON-LD, sitemap, and robots. No dependencies changed.

## Sources and decisions

- Copy: `../work/copy/landing.md` and `design-brief.md`. All public landing strings
  checked verbatim, in the design brief's section order (workflow before demo).
- Explicit task overrides: `/login` entry point, header “Log in” / “Start free”,
  dedicated `/pricing`, gross €19/€49 prices. Plan-specific login links preserve
  the selected plan. No dead `/signup` route is introduced.
- Company details copied from `https://sandbox-as-a-service.com/imprint`, retrieved
  with curl after checking its robots.txt: productivity-boost.com Betriebs UG
  (haftungsbeschränkt) & Co. KG; Reichenbergerstr. 2, 94036 Passau; Florian
  Standhartinger; Amtsgericht Passau, HRB 8453; DE296812612;
  info@productivity-boost.com; +49 178 1981631. No independent register inference.
  Omitted the obsolete ODR-platform link, as instructed by the supplied draft.
- Legal drafts resolved using the task's hosting, VAT, retention, provider,
  withdrawal and jurisdiction instructions. Stripe provider/transfer description
  checked against https://stripe.com/legal/dpa. Auth cookie names and default
  lifetime checked against installed Auth.js source and `auth.ts`.
- Billing component is the Stripe agent's committed component. No Stripe routes,
  billing libraries, database schema, authenticated app pages, or dependency files
  changed by this milestone.

## Executed checks

- `npm run lint`: pass, no errors or warnings.
- `npm run build`: pass, production compilation and TypeScript validation.
- Started production server on port 3991, sourcing `../.secrets.env` without
  printing its values, setting DATABASE_URL from DATABASE_URL_LOCAL with
  `?sslmode=require`, AUTH_URL=http://localhost:3991 and AUTH_TRUST_HOST=true.
- `node scripts/verify-marketing.mjs`: pass. `/`, `/pricing`, `/impressum`,
  `/privacy`, `/terms`, `/sitemap.xml`, `/robots.txt` all 200; exact H1 (one), all
  public landing copy present, both JSON-LD offers correct, legal dates correct,
  company/register/VAT values correct, no rendered CHECK strings.
- `curl -s localhost:3991/ | grep -c '<h1'`: 1.
- `PLAYWRIGHT_MODULE=/opt/tao-head-family-video-render-v1/node_modules/playwright/index.mjs node scripts/verify-marketing-browser.mjs`:
  pass using preinstalled browser tooling; no repository dependency added.
  Direct approval and repeated revision paths reach Published; blank feedback
  focuses the field and shows its error; markup remains text; cancel preserves
  the correct draft; failure history remains visible; replay removes only
  publishing history; reset clears all state. Keyboard activation and focus
  assertions pass. No demo network requests, local/session storage or cookies
  (browser favicon requests excluded). No browser JavaScript errors.
- Browser checks: all five pages at 320px and 1440px without document overflow;
  landing at 200% zoom; mobile navigation open/Escape-close; keyboard FAQ;
  reduced-motion setting; screenshots inspected for mobile, desktop and success.
- Text contrast ratios: primary white/green 5.48:1; secondary text on page
  7.41:1; green status 7.29:1; warning status 4.84:1. Control border/white 4.83:1.
- `git diff --check`: pass.

Screenshots are local verification artifacts at `/tmp/socialmint-desktop.png`,
`/tmp/socialmint-mobile.png`, and `/tmp/socialmint-demo-published.png`.
The browser test uses the default local port and writes these artifacts again.
For other installations, point PLAYWRIGHT_MODULE to an existing Playwright ESM
entry point; no installation is required for the HTTP verification script.

## Scope exception

The literal `grep -rn "CHECK" app components` has one match in the Stripe agent's
`app/api/stripe/checkout/route.ts`: Stripe's required `{CHECKOUT_SESSION_ID}`
substitution token. It is not an editorial marker and must remain intact.
Three checks distinguish it: full source grep (one Stripe match), editorial
`[CHECK` scan across app/components/content (zero), and rendered-page scan
(all seven endpoints, zero). The protected Stripe source was left untouched.

This milestone verifies the marketing frontend and simulated demo. Actual social
publishing integrations, production hosting configuration, payment processing,
and operational enforcement of legal retention statements are outside this task.
