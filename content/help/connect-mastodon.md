# Connect Mastodon

Authorize the intended Mastodon account and confirm its connection before scheduling.

## Steps

1. Check your instance's rules on automated posting before you connect. Many instances require an account that posts unattended to be marked in Mastodon under Preferences → Profile → This is an automated account, and may suspend accounts that do not. A suspended account cannot publish again, so settle this first.
2. Open your Mastodon instance and sign in yourself.
3. Go to Preferences → Development → New application.
4. Name the application Postial.
5. Enable the scopes write:statuses, write:media, and read:accounts.
6. Save the application and open its details.
7. Copy Your access token and keep it private.
8. In Postial, open Brands → select your brand → Connect a channel, then choose mastodon.
9. Enter your instance origin, such as https://mastodon.social.
10. Paste the token into Access token and save.
11. Check that the displayed account and instance match yours.
12. Keep posts within your instance's character limit; the default is 500.
13. Attach up to four images, each no larger than 1 MB as a conservative cross-network recommendation; uploads may need processing time.
14. If the token is revoked, create a new token and reconnect.

Postial sends a stable idempotency key when publishing a status.

## Related

- [Channels](/docs/channels)
- [Uploads](/docs/uploads)
- [Publishing reliability](/docs/publishing-reliability)
