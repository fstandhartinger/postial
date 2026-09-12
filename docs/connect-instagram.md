# Connect Instagram

In **Brands → your brand → Connect a channel**, choose **Connect Instagram** and
approve the Page access request. Instagram uses the same Meta app as Facebook:
Facebook login returns to Postial, which reads the authorizing account's Pages,
keeps the first Page that has a linked **Instagram Business account**, and stores
the long-lived **Page token** for it. **Coming soon** means the operator still
needs to configure the developer app or grant the Instagram permissions. No
Facebook or Instagram password is stored in Postial.

Each connection publishes as one Instagram Business account. A personal
Instagram account, or an account not linked to a Facebook Page, cannot be
connected; link it to a Page first. If the authorizing account manages several
Pages with an Instagram account, Postial uses the first one returned by
`/me/accounts`. Disconnect and reconnect after selecting the intended account if
that is not the right one.

Captions support up to 2,200 characters. A post must carry **images**: either a
single image or a carousel of up to ten images, each up to 8 MB. Instagram has no
text-only feed post, so a text-only target is rejected with a content error
instead of publishing an empty post. Video and Reels are not supported by the
current media flow.

If the token is rejected, choose **Reconnect** and approve the Page again. Page
tokens minted from a long-lived user token do not expire on their own, so Postial
does not run a refresh flow; revoking the app, changing the Page or Instagram
role, or removing the Page from the account requires reconnection. If a
publishing result is uncertain, check the Instagram account before retrying to
avoid a duplicate.

## Operator setup — human handoff

Reuse the Meta app created for Facebook (type **Business**) in the Meta developer
console, add the **Facebook Login for Business** product, and request only the
permissions the adapter uses:

- `pages_show_list`
- `pages_read_engagement`
- `instagram_basic`
- `instagram_content_publish`

In development, only accounts holding an app role or tester role can authorize.
Serving unrelated customers requires App Review for the permissions above and a
published app. That portal work — business verification, privacy policy, data
deletion instructions and the permission screencast — is not automated here.

Set `FACEBOOK_APP_ID` and `FACEBOOK_APP_SECRET`; Instagram has no separate
environment pair. The authorize step happens at
`https://www.facebook.com/<FACEBOOK_GRAPH_VERSION>/dialog/oauth`, and the
callback is `https://postial.co/api/oauth/instagram/callback`. `FACEBOOK_GRAPH_VERSION`
defaults to `v21.0`. Preserve `APP_ENCRYPTION_KEY`; tokens are encrypted in
PostgreSQL with it. See
[Meta's Graph API reference](https://developers.facebook.com/docs/graph-api)
and, for the local mock suite, [X verification instructions](connect-x.md#verification).

## Implementation flow — checked against this repository

1. `createAuth` builds the authorize URL with `pages_show_list,instagram_basic,instagram_content_publish`
   and a random `state`; the callback consumes that state exactly once.
2. `finishAuth` exchanges the code at
   `GET /<version>/oauth/access_token`, then swaps the short user token for a
   long-lived one via `grant_type=fb_exchange_token`, then reads
   `GET /<version>/me/accounts?fields=id,name,access_token,instagram_business_account{id,username}`
   and keeps the first Page that has an `instagram_business_account`. Its Page
   token becomes the channel credential and the Instagram id becomes the channel
   `externalId`.
3. Validation reads `GET /<version>/<ig-id>?fields=id,username` with the Page
   token; the returned `@username` becomes the channel display name.
4. Publishing creates a container with
   `POST /<version>/<ig-id>/media` (`image_url`, `caption`; carousel children add
   `is_carousel_item=true`), polls `GET /<version>/<container-id>?fields=status_code`
   until `FINISHED`/`PUBLISHED`, then calls
   `POST /<version>/<ig-id>/media_publish` with the `creation_id`. The returned
   Instagram media id becomes `remoteId`; the Graph API returns no permalink.

The adapter maps 401/403 and expired-token errors to reconnect (AUTH_EXPIRED),
429 to retry with backoff (RATE_LIMITED), 5xx to provider unavailable
(PROVIDER_DOWN) and 4xx content errors to CONTENT_REJECTED through the shared
`lib/publishers/http.ts` helpers. `scripts/verify-publishers.ts` and
`scripts/verify-oauth.ts` exercise validate, publish, the carousel flow, the
text-only rejection and the full token discovery against loopback mocks; no live
Meta call is made in tests. Because the OAuth mock endpoint is keyed by the
provider name, local runs must set both `FACEBOOK_API_BASE_URL` and
`INSTAGRAM_API_BASE_URL`.
