# Connect Threads

In **Brands → your brand → Connect a channel**, choose **Connect Threads** and
approve the account access request. The return to Postial connects that
account to your brand. **Coming soon** means the operator still needs to configure
the developer app. No Threads password is stored in Postial.

Posts support 500 characters and up to four public HTTPS images. A single image
becomes an image post; multiple images become a carousel. Images must remain
publicly reachable by Meta while the post is processed. Private URLs and internal
network addresses are rejected. Postial polls processing status before publishing.

If **Reconnect Threads** appears, connect the same account again. This updates
the existing channel. Tokens normally last 60 days, and Postial renews them
when publishing within seven days of expiry (only after their first 24 hours).
An expired token cannot be refreshed: after a long period without publishing,
reconnection may be necessary. If a publishing result is uncertain, check the
Threads account before retrying to avoid a duplicate.

## Operator research — checked 2026-09-09 UTC

Create a Meta developer app with the **Access the Threads API** use case, using
the Threads app ID and secret. Request only `threads_basic` and
`threads_content_publish`. In development, use accounts assigned the app's
Threads tester role; testers must accept their invitations. For unrelated
customers, request Advanced Access/App Review for both permissions and publish
the app. Prepare a working login, reviewer instructions, permission-specific
screencast, privacy policy, terms, account/data deletion instructions and business
verification if the console requires it. These portal steps remain a human handoff.
[Meta getting started](https://developers.facebook.com/docs/threads/get-started),
[Meta's official Postman setup](https://www.postman.com/meta/threads/documentation/dht3nzz/threads-api?entity=request-34203612-b4339073-a559-4e15-9ffe-974d6f0451ec).

Authorize at `https://threads.net/oauth/authorize` with code flow, state, redirect
URI and the two permissions. Exchange at `graph.threads.net/oauth/access_token`,
then exchange the short token at `/access_token?grant_type=th_exchange_token`.
The official collection's long-lived example returns `expires_in=5184000`
(60 days). Renew via `/refresh_access_token?grant_type=th_refresh_token` with the
current bearer token. The returned expiry is persisted. No separate Threads
refresh token is expected. Threads' documented confidential-client flow does
not advertise PKCE; the implementation uses state and app-secret authentication,
while X uses PKCE.
[Meta token requests](https://www.postman.com/meta/threads/documentation/dht3nzz/threads-api?entity=request-34203612-8d7f5856-6232-4322-9e30-528e3eacdf90).

Validation reads `/v1.0/me?fields=id,username`. Publishing creates a container at
`/v1.0/me/threads`, checks `/{container-id}?fields=status` until `FINISHED`, then
calls `/v1.0/me/threads_publish` with `creation_id`. Images use `media_type=IMAGE`
and `image_url`. Carousel children set `is_carousel_item=true`; the parent uses
`media_type=CAROUSEL` and comma-separated `children` IDs. Meta permits more items;
Postial deliberately retains its four-image limit.
[Meta carousel request](https://www.postman.com/meta/threads/documentation/dht3nzz/threads-api?entity=request-34203612-ee0a2365-9d95-4cbe-8087-1cfb04d38c05).

HTTP 401/403 and Meta token error 190 require reconnect. HTTP 429 and Meta
throttling codes 4/17/32/613 use retry backoff; 5xx maps to provider unavailable.
Account publishing quotas must be checked in the portal/API before launch; this
research did not establish a reliable current numerical quota. The adapter does
not assume an old quota or attempt to evade rate limits.

Research limitation: direct Meta documentation URLs first failed to render and
then returned HTTP 429. Requests to that site stopped; the official Meta Postman
collection and its token/carousel request pages supplied the executable API
reference. Portal labels, review requirements and the 24-hour refresh condition
should be rechecked during the manual handoff against
[Meta long-lived-token documentation](https://developers.facebook.com/docs/threads/get-started/long-lived-tokens).
No login, CAPTCHA or rate limit was bypassed.

Set `APP_URL`, `THREADS_APP_ID`, `THREADS_APP_SECRET`, and preserve
`APP_ENCRYPTION_KEY`. Callback:
`https://postial.co/api/oauth/threads/callback`.
See [X verification instructions](connect-x.md#verification) for the local mock suites.
