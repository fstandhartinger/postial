# Webhook-Test-Event: Filtered Trigger Fix

## RED

Added the focused assertion in `scripts/verify-api.ts` for an endpoint with
`events: ['approval.decided']`. Before the application fix, the verifier failed
at the new event assertion because the implementation returned `ping`:

```text
PASS auth, scopes, tenancy, shared validation, atomic idempotency, pagination, retry and delete
PASS fixture cleanup
API verification failed: at main (scripts/verify-api.ts:168:12)
```

The first attempt in the new worktree also found only the expected environment
issue: the worktree had no dependencies. A temporary local dependency setup was
used; no dependency files were changed or committed.

## GREEN

The fixed verifier passed the new assertions for:

- `event === 'approval.decided'` from the first subscribed event
- top-level `test === true`
- realistic approval sample data
- `X-Postial-Test: 1` on delivery
- normal HMAC signature verification

```text
PASS webhook API: one-time secret, scope isolation, filtered test-event signature, delivery logs, tenancy, SSRF, concurrent 10-endpoint limit and delete cancellation
PASS fixture cleanup
PASS verify:all
```

Additional required checks:

```text
npm run lint          PASS
npx tsc --noEmit     PASS
npm run build        PASS
```

`verify-c6.ts` contained a stale assertion treating the current string-valued
`availability.pending` field as if it contained the literal word `pending`.
It was updated to assert the current n8n availability contract; no production
behavior or package dependency was changed.
