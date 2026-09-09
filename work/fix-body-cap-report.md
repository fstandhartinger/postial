# Absolute post body cap

## RED

Added the requested `scripts/verify-api.ts` regression case before changing
the implementation. The first executable attempt needed the existing
dependencies linked into the new worktree; after that environment-only fix,
the test failed as expected:

```text
API verification failed: actual=201, expected=422
    at main (/tmp/socialmint-bodycap/scripts/verify-api.ts:137:12)
```

The failing request was a draft with 10,001 `x` characters and no channels.

## GREEN

The shared `savePost` validation now counts Unicode grapheme clusters and
rejects more than 10,000 characters independent of selected channels. API
responses identify `body`; Composer, bulk save, and CSV preview use the same
limit. Channel-specific checks remain additional.

```text
PASS auth, scopes, tenancy, shared validation, atomic idempotency, pagination, retry and delete
PASS five scheduled posts and targets; long row fails independently
PASS BOM/semicolon CSV, quoting, row limit, timezone distribution and DST gaps/folds
PASS API 201-row rejection, concurrent idempotency, conflict, SSRF, tenancy and Starter/draft entitlement rules
PASS verify:all
```

The API regression additionally asserts status 422, code `validation_error`,
field `body`, and the exact message `Post text must be 10,000 characters or fewer`.

