# Sources for `/compare/*`

Retrieved 2026-09-13 from the vendors’ public pages. This is the evidence register for every statement about Hootsuite or Postiz rendered by the comparison pages. “Not confirmed” means the checked public source did not establish the capability; it is not a claim that the vendor can never offer it.

## Hootsuite

- Pricing, plans, billing, account limits, trial and team approvals: [Hootsuite plans](https://www.hootsuite.com/plans) — retrieved 2026-09-13. It lists Standard from $99, Professional from $199 and Advanced up to $399 per user/month on annual billing; says prices exclude taxes; describes 10 versus unlimited social accounts; says trials are 14 days with no card; and lists team approvals on Advanced.
- Network catalogue and platform-specific claims: [Hootsuite integrations](https://www.hootsuite.com/platform/integrations) — retrieved 2026-09-13. It publicly lists Instagram, Facebook, X, LinkedIn, TikTok, YouTube, Threads, Pinterest and Bluesky, and says Threads publishing/scheduling/drafting is included on all plans. The page’s FAQ says some Instagram features need an Instagram Business account.
- Approval detail: [Hootsuite Advanced](https://www.hootsuite.com/plans/advanced) — retrieved 2026-09-13. It describes approval workflows, internal collaboration and message routing on Advanced. Neither this page nor the pricing page establishes a login-free external reviewer link, so the comparison says that flow is not confirmed.
- Failure handling: [Hootsuite publishing error guidance](https://help.hootsuite.com/s/article/troubleshoot-errors) — retrieved 2026-09-13. The comparison does not claim a Hootsuite retry control; it records that a per-post retry workflow was not verified from the checked public material.

## Postiz

- Cloud pricing, channel/team limits, trial and self-hosting: [Postiz pricing](https://postiz.com/pricing) — retrieved 2026-09-13. It lists Standard $29/month, Team $39/month, Pro $49/month and Ultimate $99/month, with their channel/team allowances; says the cloud trial is 7 days; and says Postiz offers an open-source product that can be deployed on a customer-owned cloud/server.
- Agency grouping and team roles: [Postiz homepage FAQ](https://postiz.com/) — retrieved 2026-09-13. It describes customer groups on Team, Pro and Ultimate, unlimited team members on those plans, and Admin/Member roles. It does not establish a login-free external approval link.
- API, n8n, failure semantics and supported platforms: [Postiz API overview](https://docs.postiz.com/public-api/introduction) — retrieved 2026-09-13. It documents a public API and custom n8n node, HTTP error statuses including retry-with-exponential-backoff for 5xx, and platforms including X, LinkedIn, Facebook, Instagram, Threads, Mastodon, Bluesky and Telegram. The comparison now states only that Postiz documents these platforms; it does not infer a Postial-network overlap or turn API error handling into a claim of a visible per-post UI retry button.

## Scope note

The Postial side is not vendor research: its prices come from `lib/plans.ts`, its trial length from `TRIAL_DAYS`, and its network/capability status from `content/availability.json`. The page intentionally separates those first-party facts from the competitor evidence above.
