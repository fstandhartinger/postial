# Connect TikTok

In **Brands → your brand → Connect a channel**, choose **Connect TikTok** and
approve the TikTok login. TikTok Login Kit v2 redirects back to Postial, which
exchanges the code for a 24-hour **access token** and a 365-day **refresh
token**, reads the authorizing account's `open_id` and display name, and stores
the tokens encrypted. **Coming soon** means the operator still needs to
configure the developer app. No TikTok password is stored in Postial.

Each connection publishes as one TikTok account identified by its `open_id`.
Captions support up to 2,200 characters. A post must carry **one video**
(MP4, WebM or MOV, up to 128 MB in the current download flow, because the
adapter holds the whole video in memory); TikTok has no
text-only or image post, so a text-only or image-only target is rejected with a
content error instead of publishing an empty post.

Until the Postial app passes TikTok's Content Posting API audit, TikTok
restricts all posts to **private viewing**: they are visible only to the
account owner. Postial therefore always posts with `SELF_ONLY`, the privacy
level TikTok offers every account, and reports TikTok's
`unaudited_client_can_only_post_to_private_accounts` error verbatim as a
content error if a non-private level is ever requested. After the audit, the
adapter keeps using the levels returned by TikTok's `creator_info/query`
endpoint.

The access token expires after 24 hours. Postial refreshes it automatically
before publishing with the stored refresh token (TikTok rotates the refresh
token on every refresh, and the new one is persisted). If the refresh token
itself is rejected or missing, choose **Reconnect** and approve TikTok again.
If a publishing result is uncertain after an interruption, check the TikTok
account before retrying to avoid a duplicate.

## Operator setup — human handoff

Create (or extend) a TikTok for Developers app and enable both **Login Kit**
and the **Content Posting API** (Direct Post). Request only the scopes the
adapter uses:

- `user.info.basic`
- `video.publish`
- `video.upload`

Register the redirect URI `https://postial.co/api/oauth/tiktok/callback`
(plus the local callback for development) in the app's Login Kit settings.
In development, only accounts holding an app role or tester role can
authorize. Serving unrelated customers requires the Content Posting API
audit. That portal work — the audit application, the demo video and the
screencast — is not automated here.

Set `TIKTOK_CLIENT_KEY` and `TIKTOK_CLIENT_SECRET`. The authorize step happens
at `https://www.tiktok.com/v2/auth/authorize/`, the token exchange and refresh
at `POST https://open.tiktokapis.com/v2/oauth/token/` (form-encoded with
`client_key` and `client_secret`), and publishing at the
`https://open.tiktokapis.com/v2/post/publish/...` endpoints. Preserve
`APP_ENCRYPTION_KEY`; tokens are encrypted in PostgreSQL with it. See
[TikTok's Content Posting API reference](https://developers.tiktok.com/docs/en/content-posting-api-get-started)
and, for the local mock suite, [X verification instructions](connect-x.md#verification).

## Implementation flow — checked against this repository

1. `createAuth` builds the authorize URL with `client_key`,
   `user.info.basic,video.publish,video.upload`, a random `state` and a PKCE
   `code_challenge` (S256); the callback consumes that state exactly once.
2. `finishAuth` exchanges the code at `POST /v2/oauth/token/` with
   `grant_type=authorization_code`, `code_verifier`, `client_key` and
   `client_secret`; the returned `open_id` becomes the channel `externalId`
   and the tokens are stored with their expiry.
3. Validation reads `GET /v2/user/info/?fields=open_id,display_name` with the
   access token; the returned display name becomes the channel display name.
4. Publishing queries `POST /v2/post/publish/creator_info/query/` for the
   account's `privacy_level_options`, inits the post with
   `POST /v2/post/publish/video/init/` (`source_info.source=FILE_UPLOAD`,
   `video_size`, `chunk_size`, `total_chunk_count`), uploads the video in
   sequential `PUT` chunks to the returned `upload_url` with
   `Content-Range: bytes <first>-<last>/<total>` headers (206 per chunk, 201
   for the final chunk), then polls `POST /v2/post/publish/status/fetch/`
   until `PUBLISH_COMPLETE` or `FAILED`. The returned `publish_id` (or the
   public post id when TikTok provides one) becomes `remoteId`.

The adapter maps 401 and expired-token errors to reconnect (AUTH_EXPIRED),
429 to retry with backoff (RATE_LIMITED), 5xx to provider unavailable
(PROVIDER_DOWN) and content errors to CONTENT_REJECTED through the shared
`lib/publishers/http.ts` helpers. `scripts/verify-publishers.ts` and
`scripts/verify-oauth.ts` exercise validate, the chunked publish flow, the
status polling, the text-only and image-only rejections and the full token
exchange against loopback mocks; no live TikTok call is made in tests. The
local mock endpoint is keyed by the provider name, so local runs must set
`TIKTOK_API_BASE_URL`.
