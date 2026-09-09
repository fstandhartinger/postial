# Connect X

In **Brands → your brand → Connect a channel**, choose **Connect X**, select your
X account and approve access. Return to Postial; your account appears as an
active channel. If the button says **coming soon**, the operator has not yet
configured the developer app. You never paste an X password into Postial.

Posts support 280 weighted characters and up to four public HTTPS images (1 MB
per image in Postial). URLs count as 23 characters; emoji and CJK use X's
weighted counting rules. Premium long posts, video and GIF upload are excluded.
On **Reconnect X**, use the same connection button and account: it renews the
existing channel. X billing, account restrictions and missing permissions can
also require operator action. A 429 waits for the provider's reset time. If a
publication outcome cannot be confirmed, check X before manually retrying.

## Operator research — checked 2026-09-09 UTC

The current official pricing page specifies **pay per usage, no subscription**:
ordinary post creation $0.015/request; creation with a URL $0.200/request;
user reads $0.010/resource. These are distinct published prices, not an assumed
additive surcharge. Credits and a spending limit are configured in the console;
no purchase was made. [X pricing](https://docs.x.com/x-api/getting-started/pricing).

| Requested tier | Current monthly price/write allowance |
| --- | --- |
| Free | No current Free subscription/write allowance published on the current pricing page |
| Basic | No current Basic subscription/write allowance published on the current pricing page |
| Pro | No current Pro subscription/write allowance published on the current pricing page |

Do not budget against historical tier tables: the checked page replaces them
with endpoint charges. Required access is a developer app with user-context
write/media permissions and sufficient credits; verify the final console price
before approving a budget. No legacy monthly quota is hard-coded.

The implementation uses `POST /2/tweets` with `{text, media:{media_ids}}` and
`GET /2/users/me` for connection validation. The current limits table gives
post creation **100/15 minutes/user**, **10,000/24 hours/app**; media upload
**500/15 minutes/user**, **50,000/24 hours/app**. HTTP 429 observes the Unix
`x-rate-limit-reset`; normal worker backoff also applies.
[X rate limits](https://docs.x.com/x-api/fundamentals/rate-limits).

OAuth 2 authorization code uses S256 PKCE, confidential-client Basic
authentication, and `tweet.read tweet.write users.read offline.access media.write`.
The extra `media.write` scope enables current v2 media uploads. Access tokens
normally last two hours; returned `expires_in` is authoritative. Refresh occurs
five minutes before expiry when publishing; rotated refresh tokens are stored
before the post is sent. The checked official page does not state a fixed
refresh-token expiration duration, so the implementation assumes no invented
six-month guarantee and reconnects on rejection.
[X OAuth reference](https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code).

Images use **`POST /2/media/upload`**, JSON base64 `media`, `media_type` and
`media_category=tweet_image`. This matches the current OAuth 2 v2 endpoint;
the legacy v1.1 `media/upload` route is not used by this OAuth 2 adapter.
[X media upload](https://docs.x.com/x-api/media/upload-media).
Counting uses the official [twitter-text library](https://github.com/twitter/twitter-text),
including bare-domain URL recognition, Unicode normalization and emoji sequences.

Set `APP_URL`, `X_CLIENT_ID`, `X_CLIENT_SECRET`, and preserve `APP_ENCRYPTION_KEY`.
Callback: `https://postial.co/api/oauth/x/callback`.
State expires in ten minutes and is single-use, bound to session user, provider
and brand; PKCE verifiers and channel tokens are encrypted at rest. Only brand
owners can initiate these connections. Session expiry requires restarting the flow.

## Verification

`npx tsx --test scripts/verify-publishers.ts` mocks all provider fetches.
`npx tsx scripts/verify-oauth.ts` uses a disposable local database plus HTTP
provider stubs and real Auth.js database sessions. Run migrations first and supply
`DATABASE_URL`. `X_API_BASE_URL` and `THREADS_API_BASE_URL` accept only literal
`http://127.0.0.1:<port>` overrides outside production; production ignores them.
No real X/Meta publishing or automated login is part of either test.
