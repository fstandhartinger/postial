# Changelog

## 0.2.0 — 2026-09-09

### Product milestones

- 2026-09-09 — **Notifications**: In-app notifications and optional Slack, Discord and Mattermost webhook alerts.
- 2026-09-09 — **Channel health**: Connection health checks and a shared overview of channels needing attention.
- 2026-09-09 — **Agency teams**: Invite teammates by link and manage access within the included team allowance.
- 2026-09-09 — **Image uploads**: Upload images, add alt text and preview supported network formats.
- 2026-09-09 — **API and webhooks**: Agency REST API and signed webhooks. The n8n node awaits npm publication.
- 2026-09-09 — **Client approval links**: Clients can approve or request changes through a private link without an account.
- 2026-09-09 — **Publishing core and adapters**: Brand workspaces, calendar and publishing status with Bluesky, Mastodon and Telegram adapters.
- 2026-09-08 — **Landing and billing**: Public pricing, interactive approval demo and Stripe trial checkout. Sign-in configuration remains pending.

### Subsequent improvements and release engineering

- Bulk planner, CSV preview and idempotent bulk API.
- Help centre, safe search/navigation and aligned privacy/subscription terms.
- Bounded requests, startup validation, versioned key rotation, retention, workspace/account offboarding and migration rollback contract.
- Bounded post pagination and calendar queries; responsive bulk cards, keyboard focus, accessible media alt text and locally subsetted fonts.
- Unified DB and managed standalone HTTP verification, secret-free GitHub CI, architecture/runbooks, complete environment and script inventory.
- Historical evidence removed from the Git index and preserved in the venture work directory; history is unchanged.

### Source history

The product milestone text above is preserved from `content/changelog.json`; its
sign-in/publication notes describe the milestone date, not a new acceptance claim.
The following implementation commits provide the additional release history:

- `992781d` — Fix cycle 8 performance, accessible focus and bounded post views
- `8e37e28` — Add public help center and align privacy and subscription terms
- `2dc5afb` — Complete cycle 7 safety migration, retention, startup gate and verified offboarding
- `55d8dff` — Protect capabilities and bound requests; add offboarding and key rotation services
- `a639540` — Add bulk post planner, CSV preview and idempotent bulk API
- `143cb28` — Migrate network waitlist and verify positioning across mobile and desktop
- `02138e9` — Position SocialMint around live networks and add network launch waitlist
- `5924cb9` — Keep availability checkmark on live API feature
- `0b8538d` — Verify cycle 6 flows and add ordered notification and DPA migration
- `d10a4ee` — Implement cycle 6 availability, editing, billing and workspace notifications
- `664394a` — Add pilot channel health, approval overview, media retention and draft duplication
- `91886d0` — Fix active-workspace media, decode uploads and align OAuth and provider limits
- `cd61e82` — Merge team management with ordered migrations and channel-aware composer counts
- `1ff6c40` — Finalize OAuth migration after media rebase and verify worker integration
- `f778c9c` — Verify OAuth routes and refresh locking; document developer portal handoffs
- `2db870e` — Add X and Threads OAuth publishing and refresh support
- `585ef98` — Add media storage migration and verify uploads end to end
- `b9226d1` — Add team invite links, member roles and active workspace switching
- `eeb0684` — Add image upload services and composer controls
- `297f631` — Add scoped webhook management API and approval detail links
- `cadddc1` — Fix E01–E12: dated entitlements, private approval events and independent webhook delivery
- `307c690` — Migrate API storage and verify production routes, idempotency and webhook delivery
- `a9b1a43` — Add Agency REST API v1, scoped keys and signed webhook outbox
- `8975794` — Build focused workspace shell, onboarding and publishing overview
- `7cfbf8a` — Show approval badges in posts and generate secure composer tokens

## 0.1.0 — Foundation

Initial Next.js/Auth.js/Drizzle foundation, workspace ownership, billing, marketing
pages and deployment scaffolding. The repository previously used 0.1.0 throughout
these incremental milestones; this file does not invent historical release tags.
