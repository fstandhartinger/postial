# Connect Facebook

In **Brands → your brand → Connect a channel**, choose **Connect Facebook** and
approve the Page access request. Facebook login returns to Postial. If your
Facebook account manages exactly one Page, Postial stores its long-lived
**Page token** and connects it to your brand. With several Pages, Postial
shows a Page list on a Postial page — the Pages you granted in the Facebook
dialog — and connects the Page you choose. **Coming soon** means the operator
still needs to configure the developer app. No Facebook password is stored in
Postial.

Each connection publishes as one Facebook Page. The Page selection expires
after ten minutes; if it does, connect Facebook again. To connect a different
Page later, disconnect and reconnect, then choose the intended Page.

Posts support up to 63,206 characters and up to **ten images**. Ten is
Postial's own conservative cap across channels, narrower than the Graph API's
image support; a post with more images is rejected for Facebook before any
publish call. Each image is pre-checked by Postial before upload (image
content type, at most 8 MB) and uploaded to the Page as an **unpublished
photo**; the photos are then attached to a single feed post. Image alt text is
not sent to Facebook. Videos are not attached yet. If a photo upload fails,
publishing aborts before the feed post exists, so no post appears without its
images; unpublished photos already uploaded stay invisible on the Page and a
retry uploads the images again.

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
   `GET /<version>/me/accounts?fields=id,name,access_token&limit=100`,
   following `paging.next` for at most five requests, same origin only. One Page is
   connected immediately; several Pages are kept encrypted in a ten-minute
   pending row, and the Page picker on Postial connects the chosen Page token.
3. Validation reads `GET /<version>/me?fields=id,name` with the Page token;
   the returned Page id becomes the channel `externalId`.
4. Publishing uploads each image to `POST /<version>/<page-id>/photos` as an
   unpublished photo (form fields `url` and `published=false`, Page token as a
   bearer token), then posts `message` plus `attached_media[<i>]` (a JSON
   string `{"media_fbid": "<photo-id>"}` per uploaded photo, in order) to
   `POST /<version>/<page-id>/feed` with the same bearer token. A post
   without images skips the photo uploads and posts `message` to `/feed`
   directly. A failed photo upload aborts publishing before the feed post, so
   no post is created without its images.

The adapter maps 401/403 and expired-token errors to reconnect (AUTH_EXPIRED),
429 to retry with backoff (RATE_LIMITED), 5xx to provider unavailable
(PROVIDER_DOWN) and 4xx content errors to CONTENT_REJECTED through the shared
`lib/publishers/http.ts` helpers. `scripts/verify-publishers.ts` and
`scripts/verify-oauth.ts` exercise validate, publish with and without images,
upload failures and the full token exchange against loopback mocks; no live
Meta call is made in tests.
