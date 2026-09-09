# Connect the API and webhooks

Use scoped Agency credentials and signed events to integrate your own tools.

## Steps

1. As an owner with active Agency access, open [API settings](/app/settings/api).
2. Create a named key with only the scopes your workflow needs and save it immediately; it is shown once.
3. Send it as an Authorization Bearer header over HTTPS, never in a URL or public client code.
4. Follow the [API reference](/docs/api) for endpoint examples, uploads, bulk requests and idempotency.
5. Add a public HTTPS webhook destination and select the events you need. Store its signing secret when shown.
6. Test delivery, verify signatures over raw request bytes, reject old timestamps and deduplicate event IDs before processing.
7. Inspect delivery results and revoke unused keys or delete obsolete endpoints.

API calls allow 60 requests per minute per key; respect Retry-After on 429. A workspace permits twenty active keys and ten API webhook endpoints, including disabled endpoints. Delivery retries up to five times and can arrive more than once. API deliveries pause without consuming attempts when Agency access ends.

Disable pauses a destination; Enable resumes it; Delete cancels open deliveries and removes its secret. In-flight requests may still arrive. Delivery records are removed after 30 days. Team alert destinations are configured separately and can continue after subscription access expires.

## Related

- [N8n](/docs/n8n)
- [Notifications](/docs/notifications)
- [Team](/docs/team)
