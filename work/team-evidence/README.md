Team verification — 2026-09-09

Synthetic database sessions only; no provider login or real email delivery.
Screenshots: team and join pages at 390 and 1280 pixels. Team screenshot shows
an owner, one of five Agency seats and an open editor invitation. Join screenshot
shows the authenticated second user before accepting. Tokens are not pictured.

Passed: npm run lint; npx tsc --noEmit; npm run build; npm run db:migrate;
verify-core.ts; verify-api.ts; verify-approvals.ts (HTTP + Playwright);
verify-team.ts (HTTP + Playwright + DB invariants). Team checks cover role
management, self-removal/last-owner protection, Starter creation rejection,
acceptance after downgrade, atomic concurrent consumption, already-member,
expiration/revocation, rolling rate limit, editor billing 403/settings guards,
member removal and active workspace switching. Fixtures are deleted in finally.

Migration 0008 keeps the legacy membership default to avoid using a newly added
PostgreSQL enum value inside the migration transaction. Application invitations
explicitly insert owner/editor roles. Legacy member/admin roles remain compatible.
