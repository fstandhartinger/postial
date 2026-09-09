# Export, delete and manage your DPA

Owners can export or delete workspace data, while every user can manage account deletion.

## Steps: export and agreement

1. As an owner, open [Workspace settings](/app/settings/workspace) and choose Export data.
2. Store the JSON privately. It includes brands, credential-free channel metadata, posts, targets, approvals, history and members.
3. Save any needed images separately: the export includes media URLs, not image bytes or copies from social networks. Channel credentials, API/webhook secrets and approval capabilities are omitted.
4. Read the [Data Processing Agreement](/legal/dpa) and accept it as an authorized owner in [Legal settings](/app/settings/legal). The accepted version, timestamp and document hash are recorded; use Print / Save as PDF for a copy.

## Steps: leaving or deleting

1. Before removing a member, revoke exposed API keys and replace webhook endpoints whose signing secrets need rotation. Membership removal alone leaves them active.
2. To leave as the last owner, transfer ownership to an existing member in Workspace settings or delete that workspace first.
3. For workspace deletion, export first, then enter the exact displayed workspace name and confirm Delete workspace. This cancels Stripe immediately without proration, expires open checkouts and permanently removes workspace content and integrations.
4. If Stripe cancellation fails, content has not been deleted and publishing/API/billing remain disabled; retry the same deletion in settings to finish.
5. To delete your own account, open [Account settings](/app/settings/account) and type DELETE. You cannot be the last owner of any workspace.
6. Check remote network posts and revoke provider permissions yourself. Already published posts and in-flight requests are not recalled.

Workspace deletion does not delete members’ accounts. Account deletion removes memberships, sessions and that user’s API keys; shared posts and media remain with anonymous creator IDs. Stored history removes the exact account email, but other personal information in free-form content may need separate review.

## Retention and requests

Unused media and webhook deliveries are removed after 30 days; notifications and offboarding events after 90 days. Post and approval history remains until post/workspace deletion. Container logs rotate at three files of 10 MB, not after a fixed number of days. Proxy/build-log time retention is unverified. Host backups keep the latest two successful dumps; release dumps remain through acceptance and restricted copies may persist until cleanup. Random deletion identifiers and timestamps remain to prevent reuse. See the [Privacy Policy](/privacy) for the complete lifecycle and recipients.

Network waitlist registrations are for one launch notice, not a newsletter; request removal or withdraw consent by emailing [privacy support](mailto:info@productivity-boost.com). Use the same contact for access, correction, deletion or export assistance.

## Related

- [Team](/docs/team)
- [Billing](/docs/billing)
- [Uploads](/docs/uploads)
