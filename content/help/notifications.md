# Configure team notifications

Send event notices to your chosen Slack, Discord or Mattermost destination.

## Steps

1. As an owner, open [Notification settings](/app/settings/notifications).
2. Create an incoming webhook in your chosen destination using that provider’s own settings.
3. Enter its URL in SocialMint, choose the event subscriptions and save.
4. Send a test and check the destination; tests are limited to one per destination per minute.
5. Read and acknowledge workspace notifications in the app shell. Acknowledgements are shared with your team.

Destinations receive event notices and post links, not scheduled post bodies or client comments. Your destination’s access permissions and retention apply. URLs and signing secrets are encrypted and not displayed again. Alerts may continue when subscription access expires and retry up to five times. No email or Telegram notification delivery is included. Notifications in SocialMint are removed after 90 days; delivery records after 30 days.

## Related

- [Publishing reliability](/docs/publishing-reliability)
- [Api webhooks](/docs/api-webhooks)
- [Data privacy](/docs/data-privacy)
