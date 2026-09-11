# Connect Facebook

In **Brands → your brand → Connect a channel**, choose **Connect Facebook** and
approve the Page access request. Facebook login returns to Postial, which stores
the long-lived **Page token** for the first manageable Page and connects it to
your brand. **Coming soon** means the operator still needs to configure the
developer app. No Facebook password is stored in Postial.

Each connection publishes as one Facebook Page. If the authorizing account
manages several Pages, Postial currently uses the first Page returned by
`/me/accounts`. Disconnect and reconnect after selecting the intended Page if
that is not the right one.

Posts support up to 63,206 characters and are **text only**. Images and videos
are not attached yet: a post with media still publishes its text and returns a
warning instead of silently dropping the attachments. This limit is deliberate
and narrower than the Graph API's image support.

If the token is rejected, choose **Reconnect** and approve the Page again.
Page tokens minted from a long-lived user token do not expire on their own, so
Postial does not run a refresh flow; revoking the app, changing the Page role or
removing the Page from the account requires reconnection. If a publishing result
is uncertain, check the Page before retrying to avoid a duplicate.

## Operator setup — human handoff

Create a Meta app (type **Business**) in the Meta developer console, add the
**Facebook Login for Business** product, and request only the permissions the
adapter uses:

- `pages_show_list`
- `pages_read_engagement`
- `pages_manage_posts`

In development, only accounts holding an app role or tester role can authorize.
Serving unrelated customers requires App Review for the permissions above and a
published app. That portal work — business verification, privacy policy, data
deletion instructions and the permission screencast — is not automated here.

Set `FACEBOOK_APP_ID` and `FACEBOOK_APP_SECRET`. The authorize step happens at
`https://www.facebook.com/<FACEBOOK_GRAPH_VERSION>/dialog/oauth`, and the
callback is `https://postial.co/api/oauth/facebook/callback`. `FACEBOOK_GRAPH_VERSION`
defaults to `v21.0`. Preserve `APP_ENCRYPTION_KEY`; tokens are encrypted in
PostgreSQL with it. See
[Meta's Graph API reference](https://developers.facebook.com/docs/graph-api)
and, for the local mock suite, [X verification instructions](connect-x.md#verification).

## Implementation flow — checked against this repository

1. `createAuth` builds the authorize URL with the three permissions and a random
   `state`; the callback consumes that state exactly once.
2. `finishAuth` exchanges the code at
   `GET /<version>/oauth/access_token`, then swaps the short user token for a
   long-lived one via `grant_type=fb_exchange_token`, then reads
   `GET /<version>/me/accounts?fields=id,name,access_token` and keeps the first
   Page token.
3. Validation reads `GET /<version>/me?fields=id,name` with the Page token;
   the returned Page id becomes the channel `externalId`.
4. Publishing posts `message` to
   `POST /<version>/<page-id>/feed` with the Page token as a bearer token.

The adapter maps 401/403 and expired-token errors to reconnect (AUTH_EXPIRED),
429 to retry with backoff (RATE_LIMITED), 5xx to provider unavailable
(PROVIDER_DOWN) and 4xx content errors to CONTENT_REJECTED through the shared
`lib/publishers/http.ts` helpers. `scripts/verify-publishers.ts` and
`scripts/verify-oauth.ts` exercise validate, publish, the media warning and the
full token exchange against loopback mocks; no live Meta call is made in tests.
