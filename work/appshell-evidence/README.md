# App-shell acceptance evidence

Run scripts/verify-appshell.ts against the production build on localhost:3997,
with DATABASE_URL pointing at the local test database. Credentials are sourced
from the external environment file and never recorded here.

- npm run lint, npx tsc --noEmit, npm run build.
- Playwright, real local Chrome, temporary Auth.js database session; no provider login.
- Browser creates a brand, submits an invalid Mastodon connection, verifies a human
  error and retained form values (including the synthetic password).
- An isolated synthetic active channel and Agency subscription support the remaining
  test; this does not claim successful real-provider authentication or billing.
- Browser saves a draft, edits and schedules it two days ahead, checks Calendar,
  Next up, and 3/4 onboarding. Screenshots cover 390px and 1280px, including a
  locally intercepted image preview. No real content is sent to providers.
- Expired channel and needs-review target show actionable explanations.
- Browser creates an approval request and copies its link. Checklist disappears
  and remains absent after reload. Existing post_events records copying as the
  observable proxy for sharing; delivery to a client is not claimed.
- Both dynamic-record and unmatched app 404s use the app style; marketing retains
  its own header/footer. Primary-link white text, mobile/desktop CTA visibility,
  and no horizontal overflow are asserted.
- Zero application console/page errors before intentionally requesting 404s.
- Test user deletion in finally cascades through all fixture workspace data.

results.json records the successful browser run; PNG files are visual evidence.
The first build rejected a cross-directory node_modules symlink; a local dependency
copy resolved it. Initial test selector and mobile layout findings were corrected
and the entire final flow rerun.
