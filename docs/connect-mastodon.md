# Connect Mastodon

1. Open your Mastodon instance and sign in yourself.
2. Go to Preferences → Development → New application.
3. Name the application SocialMint.
4. Enable the scopes write:statuses, write:media, and read:accounts.
5. Save the application and open its details.
6. Copy Your access token and keep it private.
7. In SocialMint, open Brands → select your brand → Connect a channel, then choose mastodon.
8. Enter your instance origin, such as https://mastodon.social.
9. Paste the token into Access token and save.
10. Check that the displayed account and instance match yours.
11. Keep posts within your instance's character limit; the default is 500.
12. Attach up to four images, each no larger than 1 MB; uploads may need processing time.
13. If the token is revoked, create a new token and reconnect.

SocialMint sends a stable idempotency key when publishing a status.
