# SocialMint help verification — September 9, 2026

Delivered 19 English Markdown help articles under /docs with category navigation, client-side search, safe React Markdown rendering, metadata, sitemap and related links. Terms and Privacy align with current features and DPA recipients. Small new-tab help links cover Composer (new/edit), Channels, Approvals, Team and Billing.

Validation on the local production standalone server at localhost:4018:

- `npm run lint`: passed.
- `npx tsc --noEmit`: passed.
- `npm run build`: passed; all 19 help articles statically generated.
- `npx tsx scripts/verify-docs.ts`: 24 docs/legal pages HTTP 200, 47 internal targets, fragment links, canonical/title metadata, sitemap coverage, unknown article 404, safe new-tab app links, 19-entry index consistency and size, no raw HTML in Markdown, malicious HTML/link rendering regression passed.
- `PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node scripts/verify-docs-browser.mjs`: all 24 public pages at 390 and 1280 pixels, one h1 per page, no horizontal page overflow or browser errors; search match, no-result, result navigation and sidebar navigation passed. Full-page screenshots in this directory; representative mobile article and desktop help index inspected visually.
- Independent read-only reviewer checked implementation and product/legal statements. Calendar filter and invoice-history wording corrected from review.
- Staged content scanned against secret environment values and credential patterns; no matches. No provider login, outgoing notification or publishing was performed.

The server used the provided local DATABASE_URL_LOCAL with sslmode=require, consistent local origins, and WORKER_ENABLED=false. Credentials were loaded privately and not printed. No database fixtures or migrations were necessary for public help pages.

Resolved verification failures: Turbopack rejected an external node_modules symlink, so dependencies were copied into the worktree; tsx required an async main wrapper; existing API preformatted examples overflowed on mobile, resolved by scroll containment in the shared docs layout (API article changes remain link additions only).

Re-run index generation after editing Markdown: `npx tsx scripts/generate-help-index.ts`. Verifier detects stale or missing entries. Add new article category/order to content/help/index.json first.

Outstanding operational/legal facts are documented in ../help-legal-open.md. No optional article screenshots were embedded; this avoids republishing old product evidence as current UI.
