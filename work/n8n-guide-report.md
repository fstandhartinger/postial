# n8n guide delivery report

## GELIEFERT

- New help article: `content/help/n8n-postial.md`.
- Existing n8n help article now points to the detailed guide; API docs link to it too.
- Help index regenerated with `npx tsx scripts/generate-help-index.ts`; `/docs` discovers the page from the index.
- The dynamic help route supplies the page-specific title and description through `seoMetadata`; the docs layout supplies the existing BreadcrumbList JSON-LD.

## Belegtabelle

| Aussage | Beleg (Datei:Zeile) |
|---|---|
| Agency plan/trial is required and the four scopes are `brands:read`, `posts:read`, `posts:write`, `webhooks:manage`. | `lib/api/auth.ts:9-17`, `lib/api/auth.ts:42-45` |
| API keys are sent as Bearer credentials and the API budget is 60 requests/minute. | `lib/api/auth.ts:34-45`, `app/api/v1/me/route.ts:5` |
| Native package, display names and credential name/fields. | `content/availability.json:19`, `n8n-nodes-socialmint/package.json:1-3`, `n8n-nodes-socialmint/nodes/SocialMint/SocialMint.node.ts:16-30`, `n8n-nodes-socialmint/nodes/SocialMintTrigger/SocialMintTrigger.node.ts:15-32`, `n8n-nodes-socialmint/credentials/SocialMintApi.credentials.ts:7-33` |
| Create node fields, values and request mapping. | `n8n-nodes-socialmint/nodes/SocialMint/SocialMint.node.ts:30-173`, `n8n-nodes-socialmint/nodes/SocialMint/helpers.ts:35-83` |
| Native trigger modes, event values, signature handling and emitted item. | `n8n-nodes-socialmint/nodes/SocialMintTrigger/SocialMintTrigger.node.ts:46-80`, `n8n-nodes-socialmint/nodes/SocialMintTrigger/SocialMintTrigger.node.ts:137-212`, `n8n-nodes-socialmint/nodes/SocialMint/helpers.ts:85-98` |
| API error codes, 429 and `Retry-After`. | `app/docs/api/page.tsx:44-45`, `lib/api/auth.ts:43-45`, `lib/api/errors.ts:13-19` |
| `continueOnFail` output and native-node handling. | `n8n-nodes-socialmint/nodes/SocialMint/SocialMint.node.ts:359-397` |
| Idempotency lifetime, conflict and serialization. | `lib/api/posts.ts:62-94`, `n8n-nodes-socialmint/nodes/SocialMint/helpers.ts:20-81` |
| Live/preparation/planned networks and registered adapters. | `content/availability.json:10-54`, `lib/publishers/types.ts:6`, `lib/publishers/index.ts:21-35` |
| Provider-specific limits and LinkedIn media caveat used in the guide. | `lib/publishers/bluesky.ts:74-80`, `lib/publishers/mastodon.ts:21-26`, `lib/publishers/telegram.ts:16-20`, `lib/publishers/linkedin.ts:7-27` |
| Page-specific SEO, sitemap inclusion and BreadcrumbList markup. | `app/docs/(help)/[slug]/page.tsx:7-20`, `app/sitemap.ts:5-7`, `app/docs/layout.tsx:1-4`, `components/marketing/DocsBreadcrumbs.tsx:4-13` |

## VERIFIZIERT WIE

- `npx tsx scripts/generate-help-index.ts`: PASS.
- `npx tsc --noEmit`: PASS (rc=0).
- `npm run build`: PASS.
- `npm run verify:all`: PASS.
- `npm run verify:http`: PASS. The final rebuilt run completed with `PASS verify:http`.
- The HTTP browser suite exercised all 24 public docs/legal pages at 390/1280 with no overflow or browser errors; the responsive documentation check passed.

## OFFEN

- The product availability manifest and existing product docs say `n8n-nodes-socialmint` is version `0.1.2`, but the inspected package source and lockfile currently say `0.1.1` (`n8n-nodes-socialmint/package.json:1-3`, `package-lock.json:1-9`). This guide reports the requested product-manifest value and does not alter or publish the package. The release/version discrepancy needs an owner decision before treating the package metadata as authoritative.
- No production data, deployment, push or package publication was performed.

## Commit

Commit on branch `feat/n8n-guide`; the final commit hash is supplied in the handoff.
