# Copy reconcile report

## Vorher

- Sign-in: `Sign-in opens shortly` was rendered by `SignInNotice` whenever the
  provider check saw no configuration. Static prerendering could preserve that
  result even when the standalone server received provider variables at runtime.
- n8n: public copy said `n8n node coming soon` / `npm publication pending`.
- Networks: X and Threads were described as awaiting approval and LinkedIn as
  connecting soon; the public availability matrix treated the three as not yet
  connectable.
- Changelog and comparison copy described sign-in as pending and n8n publication
  as pending.

## Nachher

- `SignInNotice` calls `connection()` before `configuredProviders()`, so the
  Server Component decides at request time from the configured Google and magic
  link providers. The fallback remains visible when neither provider is set.
- n8n copy now states: `n8n-nodes-socialmint 0.1.0` is available on npm and the
  Postial-branded release is coming.
- Bluesky, Mastodon and Telegram remain live. X, Threads and LinkedIn are shown
  as connectable in Early access, with their actual publishing conditions:
  pay-per-use for X, approved testers/Meta review for Threads, and personal
  profiles plus pending company-page API review for LinkedIn. Instagram/Facebook
  remain planned.
- Changelog, landing, pricing, roadmap, comparison, API docs and billing
  availability text now reflect those facts and Google/magic-link availability.

## Scope note

The repository grep still finds two conditional `coming soon` strings outside
the requested file scope: disabled login buttons when a provider is absent, and
the existing in-app provider connection message in `app/app/brands/[id]/page.tsx`.
They were not changed because the Auftrag explicitly limited edits to the
listed public-content files and the SignInNotice decision site.
