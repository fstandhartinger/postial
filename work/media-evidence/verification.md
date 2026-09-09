# Media verification — 2026-09-09

- PostgreSQL migration 0008 generated after pulling origin/main; db:migrate passed against DATABASE_URL_LOCAL with sslmode=require.
- npm run lint, npx tsc --noEmit and npm run build passed.
- scripts/verify-media.ts against real Next.js development HTTP server and temporary PostgreSQL fixtures: session required, cross-origin rejection, PNG byte-for-byte upload/GET, headers/ETag/304, text disguised as PNG 422, 6 MiB 413, exhausted Agency quota 422, foreign workspace DELETE 404, JSON Base64 and multipart API upload, posts:write scope, five images 422, referenced asset deletion 422, unreferenced deletion 204/GET 404, rate limit 429/Retry-After.
- Provider download through safeFetch and downloadImage passed locally; production ignores MEDIA_ALLOW_LOOPBACK. Public production hostname passed DNS/public-IP validation.
- Playwright screenshots at 390 and 1280: actual upload, decoded thumbnail, removal, no horizontal overflow or page errors. Screenshots show the Next.js development indicator; fixture images and users are removed afterward.
- Original JPEG/PNG/WebP/GIF bytes are retained; header validation is not a full image decoder. No native image dependency added. Provider-specific limits remain in effect.
- Removing a composer thumbnail detaches it; storage deletion is explicit through the session API. Automated retention is deferred by design.
- Query/fragment variants of own image URLs normalize to the canonical stored URL; tested through POST /api/v1/posts.
- Secret scan passed against loaded credential values and private-key/token patterns in changed files. git diff --check passed.
