# Understand publishing status and retries

Use each channel’s result to recover a failure without accidentally publishing twice.

## Steps

1. Open [Posts](/app/posts) and select the post to inspect its target statuses and history.
2. If it is a draft or awaiting approval, finish scheduling or obtain the client’s approval first.
3. For held targets, check [Billing](/app/billing) and restore publishing access; due targets are held while access is unavailable.
4. For an authentication error, reconnect the channel. For rejected content, correct the content in a new draft when the original can no longer be edited.
5. For needs review, inspect the actual network channel before selecting Retry or Skip. An uncertain Telegram response can mean the post was already delivered.
6. Review persistent warnings on published targets. Add omitted content manually instead of reposting images or the whole post.

Temporary failures retry automatically after 1, 4, 15 and 60 minutes, respecting a longer network Retry-After, with at most five attempts. Authentication and content errors need intervention. Needs review never retries automatically. Manual retry starts a new five-attempt budget and needs active access, approval and a working connection.

Scheduled or approved is not the same as published. Check all targets: one channel can succeed while another fails. A public remote link may be unavailable for private Telegram channels. The worker runs periodically; queue load and providers can delay delivery.

## Related

- [Channels](/docs/channels)
- [Billing](/docs/billing)
- [Notifications](/docs/notifications)
