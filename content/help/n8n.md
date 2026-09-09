# Use Postial with n8n

Build an HTTP workflow now and prepare for the native community node release.

## Steps: HTTP Request setup

1. Use your own running n8n installation and an active Agency workspace.
2. Create a Postial API key with the required scopes in [API settings](/app/settings/api).
3. In n8n, create a Header Auth credential named Authorization with the value Bearer followed by a space and your API key.
4. Add an HTTP Request node with the API URL and JSON body from the [API reference](/docs/api).
5. For post creation, add an Idempotency-Key based on a stable source record ID to avoid duplicates on workflow retries.
6. Execute a draft-creation request first and inspect the response before enabling scheduled publishing.

## Receive events with a trigger

1. Add an n8n Webhook trigger using a public production HTTPS URL.
2. Register that URL in Postial API settings and choose events such as post.published or approval.decided.
3. Configure raw-body signature verification as shown in the API reference before processing any event, enforce the five-minute tolerance and deduplicate payload.id.
4. Activate the workflow, send a Postial test event and inspect both delivery logs and the n8n execution.

## Native node installation status

The native package is named n8n-nodes-postial and awaits npm publication. It is not currently offered as an installable public release. After publication, an n8n owner whose installation permits community packages can install that package through Settings → Community Nodes → Install, then search for Postial or Postial Trigger. n8n Cloud discovery additionally requires n8n verification. Configure Postial API credentials with the base URL https://postial.co (without /api/v1) and your API key. Grant brands:read for dropdowns, posts:read for reads, posts:write for changes and webhooks:manage for automatic trigger registration. Until then, use the HTTP Request and Webhook nodes above. No release date is promised; contact [support](mailto:info@productivity-boost.com) for release availability.

## Native trigger setup after publication

1. Add Postial Trigger and choose one or more events, for example Approval Decided.
2. In Automatic mode, select the API credential and activate the workflow. Its public HTTPS endpoint is registered automatically; deactivation deletes that registration.
3. Alternatively, choose Manual (Paste Secret), register the production URL yourself in Postial and paste its signing secret. Disable or delete that endpoint yourself on deactivation.
4. Test visible workflow output with an approval change request. The native trigger acknowledges Postial’s ping test but intentionally emits no workflow item for it.
5. Deduplicate event IDs in downstream work. The trigger verifies raw-byte signatures with a five-minute tolerance; keep host clocks synchronized.

Native trigger signing secrets live in workflow static data or a masked node parameter, not encrypted n8n credentials. Restrict workflow exports and database access and remove secrets before sharing workflows.

Your n8n operator controls the data stored in workflow executions. Keep API keys in credentials, restrict access to executions and choose retention appropriate for your client data.

## Related

- [Api webhooks](/docs/api-webhooks)
- [Data privacy](/docs/data-privacy)
