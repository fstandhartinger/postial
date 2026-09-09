# Positioning / roadmap / waitlist verification — 2026-09-09

- `npm run lint`, `npx tsc --noEmit`, `npm run build`: PASS.
- `npm run db:generate`: generated 0013_sudden_bloodstorm after rebase onto origin/main (5924cb9), adds only network_waitlist and its indexes.
- `npm run db:migrate`: PASS against DATABASE_URL_LOCAL with sslmode=require; secret file sourced without printing values.
- `npx tsx scripts/verify-waitlist.ts`: PASS against both local dev and production standalone server. Created 201, normalized duplicate 200 (also after budget exhausted), invalid email/network 422, registration 11 from same IP 429 with Retry-After; leading forwarded IP cannot bypass; ten persisted records, source and hashed IP verified; fixtures deleted.
- `node work/verify-positioning.mjs`: PASS against production standalone server. Landing, pricing, roadmap and both comparisons at 390 and 1280; six screenshots, no horizontal page overflow, no placeholder markers, no checks for upcoming networks, metadata and JSON-LD parse correctly. Five non-live network forms on pricing/roadmap. Browser success feedback uses mocked HTTP; actual API persistence tested separately above.
- Screenshots visually inspected. No real login, mail, social publishing, LinkedIn application or paid operation performed.
- Secret scan: exact environment-secret values plus private-key/Stripe credential patterns across changed files and evidence: PASS, no values logged. `git diff --check`: PASS.

Implementation notes: the limiter counts new saved registrations in a rolling hour; repeat registrations remain idempotent and do not consume budget. PostgreSQL transaction advisory locks serialize same-IP writes across processes. Keyed IP hashes use APP_ENCRYPTION_KEY (AUTH_SECRET fallback). Ingress must append/overwrite X-Forwarded-For and the app port must remain private; rightmost IP is used and IPv6/mapped addresses are normalized. Missing header shares the unknown-IP budget. No mail sender is called. Double opt-in and actual launch notification dispatch are deferred as requested.

Resolved test setup issues: Turbopack rejected a node_modules symlink outside its root, so dependencies were copied into the worktree. The first tsx run rejected top-level await in the repository's CJS mode; the script now runs through async main. Final runs above passed.

Changelog facts/date boundaries were read from the parent SocialMint LEDGER cycles 1–6 (core/approval delivered shortly after midnight September 9). LinkedIn research sources and pending manual inputs are in work/handoffs-linkedin.md.
