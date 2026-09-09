# Workspace offboarding

Removing a member stops session access to that workspace. It does not revoke
workspace API keys or disable webhook endpoints created by that member.

Before removal, Team displays “This member created N API keys — review them”.
Open Settings → API & webhooks, identify the creator, and revoke keys whose value
may still be known to the departing member. Recreate affected webhook endpoints
and update consumers with the new signing secret to rotate it. Coordinate this
with workflow owners because revoked credentials stop integrations.

API settings are owner-only. Editors may manage posts, brands and all channel
connections, including X/Threads OAuth. Deleting a user database record differs
from removing membership: the existing creator foreign key cascades deletion to
the user’s API keys. Webhooks remain workspace-bound.
