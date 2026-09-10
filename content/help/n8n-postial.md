# Plan, approve and publish Postial posts from n8n

Use n8n to create Postial drafts, send them through client approval, and publish them now or at a scheduled time. The same workflow can listen for signed publication and approval events.

## Before you start

The API and the native node require an active Agency plan or Agency trial. Create a named API key in Postial’s [API settings](/app/settings/api), copy it when it is shown, and grant only the scopes the workflow needs:

- `brands:read` loads brands and channels in the native node.
- `posts:read` reads posts and post details.
- `posts:write` creates, retries and deletes posts.
- `webhooks:manage` registers, lists, tests and deletes API webhook endpoints and reads delivery logs.

The API checks Agency access before the scope check. The API key is sent as `Authorization: Bearer YOUR_API_KEY` over HTTPS. Keep it in an n8n credential, not in a node expression or URL. The API allows 60 requests per minute per key across its endpoints.

## Steps

## The native community node

The product availability manifest identifies the package as `n8n-nodes-socialmint`, version `0.1.2`. In n8n it appears as **Postial** and **Postial Trigger**. The package name still carries the earlier SocialMint brand.

In an n8n installation that permits community packages, install `n8n-nodes-socialmint`. Create the credential type **Postial API**. Its fields are **Base URL** (default `https://postial.co`) and **API Key**. The credential adds the Bearer header and tests `GET /api/v1/me`.

### Create and schedule a post

Add a **Postial** node and choose these actual fields:

1. Resource: `Post`.
2. Operation: `Create`.
3. **Brand Name or ID** (`brandId`): select a loaded brand or pass its ID by expression.
4. **Channel Names or IDs** (`channelIds`): select the destination channel IDs.
5. **Text** (`text`): the post body.
6. **Media URLs** (`mediaUrls`): public media URLs, one per line; the node sends up to four after trimming blank lines.
7. **Link URL** (`linkUrl`): optional link.
8. **Schedule** (`schedule`): choose `Draft`, `Now`, or `Scheduled Time` (`draft`, `now`, or `later`).
9. If `Scheduled Time` is selected, fill **Scheduled At** (`scheduledAt`) with a date that n8n can parse; the node sends it as an ISO timestamp.
10. **Requires Approval** (`requiresApproval`): set `true` when a client must approve before publishing.

The node sends `brand_id`, `channel_ids`, `body`, `media_urls`, `requires_approval`, and optional `link_url` to `POST /api/v1/posts`. Draft means it omits `scheduled_at`; `Now` sends `scheduled_at: "now"`; a scheduled time sends the normalized ISO value. A scheduled post with approval remains held until approval. The API response is the created post, including fields such as `id`, `status`, `scheduled_at`, `requires_approval`, and (when available) `approval_url`.

A practical workflow is: source record → Postial Create (`Draft`, `Requires Approval: true`) → send the returned approval link to the reviewer → Postial Trigger for `approval.decided` → inspect the decision → schedule or retry only after the decision and post status are known. For a post that should publish automatically, use `Scheduled Time` and leave approval off.

The node also exposes Post operations `Get`, `Get Many`, `Retry` and `Delete`, plus `Brand` and `Channel` with `Get Many`. `Get Many` can filter posts by brand and status; with **Return All** it follows the API cursor. Its **Limit** defaults to 50 when Return All is off.

### What the trigger returns

Add **Postial Trigger**, select one or more of these event values, and activate the workflow:

- `approval.decided`
- `post.failed`
- `post.needs_review`
- `post.published`

In **Automatic** registration, the node creates the Postial webhook endpoint when the workflow is activated and deletes it on deactivation. This requires the `webhooks:manage` scope. In **Manual (Paste Secret)** mode, register the node’s production URL yourself and paste the endpoint signing secret into **Signing Secret**.

The trigger verifies the raw request bytes and the `X-Postial-Signature` header (the deprecated `X-SocialMint-Signature` header is also accepted), rejects a timestamp outside five minutes, returns HTTP 401 for an invalid signature, parses JSON, and emits one n8n item only when the event is one of the selected values. The item’s JSON is the complete event body, with this shape:

```json
{
  "id": "EVENT_ID",
  "event": "approval.decided",
  "created_at": "TIMESTAMP",
  "data": {
    "post_id": "POST_ID",
    "brand_id": "BRAND_ID",
    "decision": "approved",
    "decided_at": "TIMESTAMP",
    "has_comment": false,
    "post_url": "https://postial.co/app/posts/POST_ID"
  }
}
```

The trigger’s signing secret is held in n8n workflow static data for automatic registration or in the masked manual node parameter; it is not an encrypted n8n credential. Restrict workflow exports and execution access. Deduplicate `payload.id` (the event `id`) downstream because webhook delivery is at least once.

## HTTP Request alternative

If community nodes are not allowed, use n8n’s built-in **HTTP Request** and **Webhook** nodes. Create a Header Auth credential with header name `Authorization` and value `Bearer YOUR_API_KEY`. Point HTTP Request at `https://postial.co/api/v1` and use JSON bodies from the [REST API reference](/docs/api).

For a first safe run, create a draft:

```json
{
  "brand_id": "BRAND_ID",
  "body": "Hello from n8n",
  "media_urls": [],
  "channel_ids": ["CHANNEL_ID"],
  "requires_approval": true
}
```

Use `POST /posts`, then inspect `GET /posts/POST_ID`. Add `scheduled_at: "now"` or a future ISO 8601 timestamp with an explicit offset when ready to publish. Use `POST /posts/POST_ID/retry` only for failed, held or needs-review targets after checking the channel; use `PATCH /posts/POST_ID` for date-only rescheduling.

To receive events without the native trigger, use an n8n Webhook node with a public HTTPS production URL. Register it in API settings or with `POST /webhooks` using `webhooks:manage`. Verify the HMAC over `timestamp + "." + exact raw JSON bytes`, enforce the five-minute timestamp tolerance, return 2xx only after durable handling, and deduplicate the event ID. The API sends `post.published`, `post.failed`, `post.needs_review` and `approval.decided` events; delivery retries up to five times and honors only a 2xx response as success.

## Errors, 429 responses and retries

The API’s documented response codes are:

- `401` `unauthorized`: the key is missing, invalid or revoked.
- `403` `agency_required` or `insufficient_scope`: Agency access or the selected scope is missing.
- `404` `not_found`: the route or workspace resource is unknown.
- `405` `method_not_allowed`: the method is unsupported; the response includes `Allow`.
- `409` `invalid_status` or `idempotency_conflict`: the operation conflicts with the post state or a reused key has different input.
- `413`: the request body is too large.
- `422` `validation_error`: input is invalid.
- `429` `rate_limited`: the per-key request limit was exceeded.
- `500` `internal_error`: a temporary server-side failure.

On `429`, the API sends `Retry-After` in seconds. The native node does not sleep and retry the request itself: with `continueOnFail` disabled it raises an n8n API error; with `continueOnFail` enabled it emits an item containing `error`, `statusCode`, `code`, and (when present) numeric `retryAfter`. Add an n8n retry/backoff branch if the workflow should try again.

For post creation, send an `Idempotency-Key` that is 1–200 printable non-space ASCII characters. Reuse the same key only for the same request body and API key. Equivalent requests within 24 hours return the stored response and do not create a duplicate; changed input returns `409`. Concurrent requests with the same key are serialized. The native node creates an automatic key from workflow/execution/node/item/run identity and a canonical hash of the body; supply **Custom Idempotency Key** when a stable source-record key must survive workflow executions.

Publishing has separate provider behavior: temporary retryable failures use the service’s backoff, while authentication and content errors need intervention. An uncertain provider response can become `needs_review`; inspect the network before retrying so an already-published post is not duplicated. A scheduled or approved status is not confirmation that every network has published.

## Networks and limits

The current live adapters registered by the service are Bluesky, Mastodon, Telegram, X, Threads and LinkedIn. The public availability manifest marks Bluesky, Mastodon and Telegram as live. X, Threads and LinkedIn are preparation/early-access connections with stated platform conditions, so do not assume that a workflow can publish there. Instagram and Facebook are planned, not connected publishing targets.

Postial does not publish to every network, does not guarantee delivery at the scheduled minute, and does not turn an approval into a successful network publication. It does not provide video upload in the current media flow. Check each target’s status and warnings after publication; one channel may succeed while another fails.

## Related

- [API and webhooks](/docs/api-webhooks)
- [REST API reference](/docs/api)
- [Use Postial with n8n](/docs/n8n)
- [Publishing status and retries](/docs/publishing-reliability)
- [Data privacy](/docs/data-privacy)
