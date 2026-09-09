ALTER TYPE "public"."post_status" ADD VALUE 'skipped';--> statement-breakpoint
ALTER TYPE "public"."target_status" ADD VALUE 'needs_review' BEFORE 'queued';--> statement-breakpoint
ALTER TYPE "public"."target_status" ADD VALUE 'held' BEFORE 'queued';--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "meta" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "post_targets" ADD COLUMN "attempt_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "post_targets" ADD COLUMN "warnings" jsonb DEFAULT '[]'::jsonb NOT NULL;