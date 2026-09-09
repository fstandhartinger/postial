import Link from 'next/link';
import spec from '@/public/openapi.json';
export const metadata = {title: 'API v1 documentation', description: 'Connect SocialMint to n8n and your tools using API keys and signed webhooks.', alternates: {canonical: '/docs/api'}};
const example = {brand_id: '11111111-1111-4111-8111-111111111111', body: 'Hello from SocialMint', media_urls: [], channel_ids: ['22222222-2222-4222-8222-222222222222'], scheduled_at: 'now', requires_approval: true};
const signatureExample = `import { createHmac, timingSafeEqual } from 'node:crypto';

// rawBody must be the exact request bytes, before JSON parsing.
export function verify(rawBody, header, secret) {
  const match = /^t=(\\d+),v1=([a-f0-9]{64})$/.exec(header ?? '');
  if (!match) return false;
  const [, t, v1] = match;
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const expected = createHmac('sha256', secret)
    .update(t + '.').update(rawBody).digest();
  return timingSafeEqual(expected, Buffer.from(v1, 'hex'));
}
// After verification: deduplicate payload.id, durably enqueue, return 2xx.`;
export default function ApiDocs() {
  return <article className="legal"><h1>SocialMint REST API v1</h1><p>Automate brand publishing with the Agency plan, including Agency trials. <Link href="/app/settings/api">Manage keys and webhooks</Link> · <a href="/openapi.json">Download OpenAPI 3.1</a></p>
    <h2>Authentication and scopes</h2><p>Create a named API key and copy it immediately. The key is shown once and stored as a SHA-256 hash. Send it over HTTPS in the Authorization header. Revocation is immediate. API access returns 403 if Agency access ends.</p>
    <pre className="overflow-x-auto">{'curl https://socialmint.app.mintapis.com/api/v1/me \\\n  -H "Authorization: Bearer $SOCIALMINT_API_KEY"'}</pre>
    <p>Scopes: posts:read for lists and details, posts:write for creation, retry and deletion, brands:read for brands and channels. GET /me accepts any valid key and returns workspace, plan, limits and scopes.</p>
    <h2>Endpoints</h2><p>All paths below are relative to https://socialmint.app.mintapis.com/api/v1. IDs belong to your workspace; foreign resource IDs return 404. Responses use snake_case fields.</p>
    <div className="overflow-x-auto"><table><thead><tr><th>Method</th><th>Path</th><th>Behavior</th></tr></thead><tbody>{Object.entries(spec.paths).flatMap(([path, methods]) => Object.entries(methods).map(([method, operation]) => <tr key={method + path}><td>{method.toUpperCase()}</td><td><code>{path}</code></td><td>{operation.summary}</td></tr>))}</tbody></table></div>
    <h3>Create a post</h3><pre className="overflow-x-auto">{'curl https://socialmint.app.mintapis.com/api/v1/posts \\\n  -H "Authorization: Bearer $SOCIALMINT_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -H "Idempotency-Key: campaign-42-post-1" \\\n  --data ' + "'" + JSON.stringify(example, null, 2) + "'"}</pre>
    <p>Omit scheduled_at to save a draft. Otherwise use &quot;now&quot; or a future ISO 8601 date with an explicit timezone, such as 2027-01-20T09:00:00+01:00. Scheduled posts require at least one active channel. Set requires_approval to true to hold publication until the customer approves. A scheduled approval request returns approval_url.</p>
    <p>The same composer rules apply: nonempty body up to 100,000 characters, provider text limits including appended links, up to four public HTTPS media URLs, HTTPS link_url and channels belonging to the selected editable brand. Invalid input returns 422; request bodies are limited to 512 KB.</p>
    <pre className="overflow-x-auto">{JSON.stringify({id: '33333333-3333-4333-8333-333333333333', ...example, status: 'pending_approval', approval_url: 'https://socialmint.app.mintapis.com/r/<token>', created_at: '2026-09-09T12:00:00Z', updated_at: '2026-09-09T12:00:00Z'}, null, 2)}</pre>
    <h3>Read brands, channels and workspace</h3><pre className="overflow-x-auto">{`GET /brands → {"data":[{"id":"<brand_id>","name":"Acme","slug":"acme","timezone":"Europe/Berlin","color":"#047857"}]}
GET /brands/<brand_id>/channels → {"data":[{"id":"<channel_id>","provider":"mastodon","display_name":"Acme","status":"active","url":"https://example.social/@acme"}]}
GET /me → {"workspace":{"id":"<workspace_id>","name":"Agency","slug":"agency"},"plan":"agency","limits":{"brands":15,"seats":5,"requests_per_minute":60},"scopes":["posts:read"]}`}</pre>
    <h3>List, inspect, retry and delete</h3><p>GET /posts?brand_id=&amp;status=&amp;limit=20&amp;cursor= accepts a limit of 1–100 (default 20). Omit unused filters. Results are ordered by ascending UUID; pass next_cursor into the next request until it is null. New concurrent inserts may require a later full sync.</p>
    <pre className="overflow-x-auto">{`GET /posts → {"data":[{"id":"<post_id>","brand_id":"<brand_id>","body":"Hello","status":"scheduled", "media_urls":[],"link_url":null,"scheduled_at":"2027-01-20T08:00:00Z","requires_approval":false,"created_at":"2026-09-09T12:00:00Z","updated_at":"2026-09-09T12:00:00Z"}],"next_cursor":null}
GET /posts/<post_id> → { ...post, "targets":[{"id":"<target_id>","channel_id":"<channel_id>","status":"failed","remote_url":null,"last_error_human":"Reconnect this channel.","attempts":1,"warnings":[]}],"events":[{"id":"<event_id>","target_id":"<target_id>","type":"failed","message":"Attempt 1 failed","created_at":"2026-09-09T12:01:00Z"}]}
POST /posts/<post_id>/retry → 200, same shape as GET /posts/<post_id>
DELETE /posts/<post_id> → 204, empty body`}</pre>
    <p>Retry resets eligible failed, held or needs_review targets to queued. Check the remote channel before retrying needs_review to avoid duplicates. Posts must already be scheduled and approved; reconnect inactive channels first. Delete permits only draft/scheduled posts whose publishing attempts have not started; otherwise it returns 409.</p>
    <h2>Errors, rate limits and idempotency</h2><pre>{'{"error":{"code":"validation_error","message":"Use up to four HTTPS media URLs."}}'}</pre><p>401: missing/invalid/revoked key; 403: Agency or scope required; 404: resource not found; 409: invalid status or idempotency conflict; 413: oversized body; 422: invalid input; 429: rate limit; 500: temporary server failure.</p>
    <p>Each key permits 60 requests per minute across all endpoints and server processes. A 429 response includes Retry-After in seconds. POST /posts accepts Idempotency-Key (1–200 printable non-space ASCII characters). For 24 hours, repeated equivalent validated input with that key and API key returns the same 201 body, even after the post changes. Different input returns 409. Concurrent duplicates are serialized. Validation failures do not reserve the key. Use a new key for a new post.</p>
    <h2>Webhooks</h2><p>Create a public HTTPS endpoint in API settings and save its one-time signing secret. Select post.published (all active targets published), post.failed (terminal failure or partial failure), post.needs_review (manual verification needed) and approval.decided (customer decision). Test events use the first subscribed event and data.test=true.</p>
    <pre className="overflow-x-auto">{JSON.stringify({id: '<event_id>', event: 'approval.decided', created_at: '2026-09-09T12:00:00Z', data: {post_id: '<post_id>', decision: 'approved', comment: '', reviewer_name: 'Alex'}}, null, 2)}</pre>
    <p>Delivery runs asynchronously on the 30-second worker tick with at most five attempts. Failures retry after 1, 5, 30 and 30 minutes. Only 2xx acknowledges delivery. Redirects and private/reserved addresses are rejected. Deliveries are at least once; deduplicate payload.id. X-SocialMint-Delivery identifies the endpoint delivery. Disabling an endpoint stops future claims; an already in-flight request may finish. Delivery requires Agency access.</p>
    <p>X-SocialMint-Signature is t=&lt;Unix seconds&gt;,v1=&lt;hex HMAC-SHA256&gt;. Sign the exact timestamp + &quot;.&quot; + raw JSON bytes with the signing secret. Reject timestamps older than five minutes and compare in constant time:</p><pre className="overflow-x-auto">{signatureExample}</pre>
    <h2>n8n</h2><p>n8n node coming soon; use HTTP Request node meanwhile.</p><p>Create a Header Auth credential with name Authorization and value Bearer followed by your API key. In HTTP Request choose POST, URL https://socialmint.app.mintapis.com/api/v1/posts, JSON body mode, and the create-post JSON above. Add Idempotency-Key using a stable source record ID, for example campaign-42-post-1. Use an n8n Webhook node with a production HTTPS URL to receive events; verify the signature over raw bytes before processing.</p>
  </article>;
}
