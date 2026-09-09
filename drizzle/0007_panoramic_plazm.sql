ALTER TABLE "webhook_deliveries" ADD COLUMN "pause_reason" text;--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
-- Remove historical reviewer PII from all retained outbox records, including delivered events.
UPDATE webhook_deliveries SET payload = jsonb_set(payload, '{data}',
  jsonb_build_object('post_id', payload->'data'->'post_id',
    'brand_id', (SELECT to_jsonb(p.brand_id) FROM posts p WHERE p.id::text = payload->'data'->>'post_id'),
    'decision', payload->'data'->'decision',
    'decided_at', COALESCE(payload->'data'->'decided_at', payload->'created_at'),
    'has_comment', COALESCE(length(payload->'data'->>'comment'), 0) > 0,
    'post_url', 'https://socialmint.app.mintapis.com/app/posts/' || (payload->'data'->>'post_id')))
WHERE event = 'approval.decided' AND payload->'data' ? 'post_id';--> statement-breakpoint
UPDATE webhook_deliveries SET payload = jsonb_set(payload, '{data}', (payload->'data') - 'reviewer_name' - 'comment')
WHERE jsonb_typeof(payload->'data') = 'object';--> statement-breakpoint
UPDATE webhook_deliveries d SET status = 'paused', pause_reason = 'Endpoint disabled', next_attempt_at = NULL
FROM webhook_endpoints e WHERE d.endpoint_id = e.id AND NOT e.active AND d.status = 'pending';
