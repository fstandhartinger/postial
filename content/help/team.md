# Invite your team and choose roles

Owners administer a workspace while editors manage its brands, channels and posts.

## Steps

1. As an owner, open [Team](/app/settings/team) and check the selected workspace and seat count.
2. Create an invitation with the appropriate role and copy the one-time link.
3. Share it privately. No invitation email is sent by Postial.
4. The recipient signs in themselves, then accepts the invitation. Links expire after seven days and can be used once.
5. Revoke unused invitations and adjust roles or remove members in Team.
6. Before offboarding, review the member’s API keys and revoke exposed keys; replace webhook endpoints if their signing secrets need rotation.

Starter has one seat; Agency has five. Invitations do not reserve seats, so capacity is checked again on acceptance. Client reviewers do not use seats. Owners cannot remove themselves or demote the last owner. Use Workspace settings to transfer ownership to an existing member when leaving.

Removing a membership ends that member’s workspace session access but leaves workspace API keys and webhooks active. Deleting the entire account is different and removes keys created by that user.

## Related

- [Workspace](/docs/workspace)
- [Api webhooks](/docs/api-webhooks)
- [Data privacy](/docs/data-privacy)
