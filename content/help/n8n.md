# Use Postial with n8n

Install the native community node, or build an HTTP workflow instead.

## Steps: install the native node

1. In n8n, open Settings, then Community nodes, and choose Install.
2. Enter the package name `n8n-nodes-socialmint` and confirm. The package still carries the former brand name; the nodes appear as "Postial" and "Postial Trigger".
3. Create a credential of type "Postial API" and paste an API key from [API settings](/app/settings/api) in Postial.
4. Add the Postial node for actions, or the Postial Trigger node to receive signed webhooks.

## Steps: HTTP Request setup

1. Use your own running n8n installation and an active Agency workspace (an Agency trial also works).
2. Create a Postial API key with the required scopes in [API settings](/app/settings/api). The key is shown once, so copy it immediately.
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

The published community package is `n8n-nodes-socialmint` 0.1.2. In n8n it appears as “Postial” and “Postial Trigger”; only the npm package name carries the former brand. An n8n owner whose installation permits community packages can install it through Settings → Community Nodes → Install. Configure the “Postial API” credential with base URL `https://postial.co` and your API key. Grant `brands:read` for dropdowns, `posts:read` for reads, `posts:write` for changes and `webhooks:manage` for automatic trigger registration. The API itself is served under `https://postial.co/api/v1`.

## Native trigger setup

1. Add Postial Trigger and choose one or more events, for example Approval Decided.
2. In Automatic mode, select the API credential and activate the workflow. Its public HTTPS endpoint is registered automatically; deactivation deletes that registration.
3. Alternatively, choose Manual (Paste Secret), register the production URL yourself in Postial and paste its signing secret. Disable or delete that endpoint yourself on deactivation.
4. Test visible workflow output with Postial’s test event. The test sends a sample of the first subscribed event, so event-filtered triggers emit a workflow item.
5. Deduplicate event IDs in downstream work. The trigger verifies raw-byte signatures with a five-minute tolerance; keep host clocks synchronized.

Native trigger signing secrets live in workflow static data or a masked node parameter, not encrypted n8n credentials. Restrict workflow exports and database access and remove secrets before sharing workflows.

Your n8n operator controls the data stored in workflow executions. Keep API keys in credentials, restrict access to executions and choose retention appropriate for your client data.

## Related

- [Api webhooks](/docs/api-webhooks)
- [Data privacy](/docs/data-privacy)
