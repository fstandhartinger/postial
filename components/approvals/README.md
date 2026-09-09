# Client approvals

The public `/r/[token]` route returns a standalone, escaped HTML document. It has
no Auth.js session dependency, JavaScript requirement, marketing layout or RSC
payload. The form POST calls the Zod-validated server action. Tokens occur only
in URL paths; forms submit to their current path. HTML responses are no-store and
send `X-Robots-Tag: noindex, nofollow, noarchive` in addition to robots metadata.

Configure `NEXT_PUBLIC_APP_URL` (fallback `AUTH_URL`) to the exact public origin.
`AUTH_SECRET` is required for salted IP and rate-limit hashes. Only enable
`APPROVAL_TRUST_PROXY=true` when the ingress **overwrites** `X-Real-IP` with the
actual client address. Otherwise all untrusted peers share a conservative
10-actions/hour limit for each token. Limits persist in PostgreSQL across
processes. Invalid submissions count, cross-origin requests do not. Old limiter
rows are deleted when their post is deleted; expired rows reset on next use.

Decisions serialize on the post and its targets. If a worker has already claimed
or published any target, the public view becomes read-only and writes return 409.
Approval sets the same target `next_attempt_at` as agency scheduling and the
existing worker's held-target activation; requesting changes clears it. Both the
decision and event are committed with the post state. Database wall-clock decision
timestamps preserve history order even when concurrent transactions wait on locks.

The existing global CSP overrides route CSP and permits only same-origin images
plus Google avatars. Previews therefore use `?media=<index>` on the capability
path. The image reader accepts only stored HTTPS raster URLs, pins a public DNS
address, rejects private/reserved addresses and redirects, forwards no credentials,
and limits images to 5 MiB / 5 seconds. SVG and redirect-only image hosts are not
supported. Referrer metadata uses `same-origin` (not `no-referrer`, which causes
Chromium to send a null Origin on native form POST); outbound links use noreferrer.

## Ownership boundary / remaining integration

Only the permitted detail-page `<ApprovalPanel post={post} />` insertion and its
import modify an existing app page. The panel upgrades the existing composer's
UUID to 32 random bytes before displaying any link. This is concurrency-safe, but
token creation happens on the first detail render, not inside the composer write.
When the owner of `app/app/actions.ts` integrates this milestone, replace its
`crypto.randomUUID()` for approval tokens with `newApprovalToken()` from
`lib/approvals.ts`. That removes the compatibility upgrade from the normal path.

`ApprovalStatusBadge` is ready to render with the list's existing post object:

```tsx
import { ApprovalStatusBadge } from "@/components/approvals/status-badge";
// Inside each post card:
<ApprovalStatusBadge post={p} />
```

Its **list insertion remains open** because `app/app/posts/page.tsx` is explicitly
outside this task's file allocation. Three existing integration paths were checked:
(1) the list directly renders its status string and therefore requires an edit;
(2) the shared Card receives no post/status data and cannot supply the badge;
(3) the one permitted ApprovalPanel insertion only renders on the detail page.
No cross-file runtime patching or global DOM/CSS injection was used. The existing
composer sentence saying links arrive next release also needs its file owner's
copy update. Zod resolves from the current locked dependency tree and is bundled
by Next; declare it directly in package.json when that file's owner updates deps.

## Verification

Export the instructed local DATABASE_URL securely and start the production app
on port 3995 with NEXT_PUBLIC_APP_URL and AUTH_URL set to http://localhost:3995.
Run db:generate, db:migrate, lint, tsc --noEmit and build. Then:

```sh
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs npx tsx scripts/verify-approvals.ts
```

The script uses disposable DB users/workspaces/posts and a synthetic session,
never a real provider login. All fixtures cascade-delete in finally. Publishing
is scheduled in the future; synthetic channel credentials are never sent anywhere.
Tests cover public 200/404, output escaping and absence of internal data, same-origin
POST enforcement, validation, decisions/events, queue activation and revocation,
cross-workspace rotation rejection, concurrent 11-request limiting, image SSRF
address rejection, 390px keyboard use, real composer and regeneration actions,
and published read-only state. The browser image itself is intercepted with a
fixture; a separate real public PNG fetch returned 200/image/png (13,504 bytes). Screenshot: /tmp/postial-approvals-mobile.png.

README has no runnable secret-scan command. Before commit/push, scan tracked changes
for credential patterns and compare them against loaded secret values without
printing matches or values. The required table migration changes no existing columns.
