# Workspace and account offboarding

Removing a member stops session access; workspace API keys and webhook endpoints remain active. Before removal, review the member's keys in Settings → API & webhooks and revoke exposed ones. Recreate webhook endpoints to rotate signing secrets and update consumers. Editors can manage posts, brands and channel connections; only owners administer workspace data/billing/team.

## Workspace export and deletion

Authenticated owners use `/app/settings/workspace` → **Export data**. The JSON download includes brands, credential-free channel metadata, posts, targets, approvals, history, members and up to 1,000 uploaded media metadata entries. Small media bytes are included as base64 up to the export byte budget. The export reports omitted media entries; omitted files must be loaded individually before deleting the workspace. It omits channel credentials, API/webhook secrets, Google tokens and approval capabilities. Keep the export private. External network copies are not bundled.

**Delete workspace** requires the exact displayed name. The server rechecks owner membership under the workspace lock, blocks concurrent Checkout provisioning, records deletion-started and persistently disables API/publishing/billing. It expires open Stripe checkouts and cancels subscriptions without proration or immediate invoicing, then deletes workspace-owned brands/channels/posts/targets/approvals/history/media/keys/webhooks/deliveries/invites/members/billing mappings. If Stripe fails, no workspace content is deleted; retry the same operation in settings to complete. Random workspace-ID deletion markers prevent late Stripe events from resurrecting the workspace. Event names and timestamps are retained for 90 days, without email/name. Deletion markers and media tombstones contain only random identifiers and times and remain for revocation.

Already in-flight outbound requests may complete. Verify relevant network posts manually, revoke provider permissions at the network, and delete remote posts there when requested. Workspace deletion does not delete member accounts or other workspaces. Stripe retains independent billing records under its own obligations; canceling a subscription is not deleting a Stripe customer or legal invoice.

## Account deletion and ownership

`/app/settings/account` → **Delete my account** requires typing DELETE. The server locks affected workspaces and blocks deletion if the user is the last owner anywhere. Use **Transfer ownership** to select an existing member: they become owner, the actor becomes editor, and the legacy owner pointer changes atomically. Alternatively delete the workspace first.

Account deletion removes identity-provider accounts, sessions, verification tokens, memberships and creator API keys. Shared posts and media remain, with NULL creator IDs; workspace ownership cannot cascade from user deletion. The exact account email is anonymized in stored approval/publishing/notification history and webhook payloads, and matching waitlist registrations are removed. Free-form content may contain other personal information: review it under the customer's erasure instructions. No provider login is required for the workflow beyond an existing authenticated app session.

## Retention and recovery

A daily guarded worker transaction deletes unused images older than 30 days, webhook deliveries older than 30 days, notifications older than 90 days, rate windows expired for one day, invites consumed/revoked/expired for 30 days, OAuth states expired for one day and offboarding events older than 90 days. Post/approval history remains until its post/workspace is deleted. `/m/<id>` sends private/no-store and returns 410 for recorded deletions. Previously cached copies (including URLs cached under the former one-year policy) and social-network downloads cannot be recalled by the origin.

Postial's inspected container logs use size rotation: three files of 10 MB, not a fixed number of days. Host database backups keep the latest two successful dumps; predeploy dumps are held through release acceptance. Offsite backup and proxy/build-log time retention are not verified. See venture ops/RELEASE.md and BACKUP-STATUS.md. On restore, apply erasure/deletion records again before reopening traffic. Store exports/dumps only in private operator-controlled locations; delete temporary verification databases after checking recovery.
