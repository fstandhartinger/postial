CREATE TYPE "public"."metric_outcome" AS ENUM('ok', 'unsupported', 'auth_expired', 'provider_error');--> statement-breakpoint
CREATE TABLE "public"."post_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_id" uuid NOT NULL,
	"provider" "public"."channel_provider" NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"outcome" "public"."metric_outcome" NOT NULL,
	"likes" integer,
	"replies" integer,
	"reposts" integer,
	"quotes" integer,
	"impressions" integer
);
--> statement-breakpoint
CREATE INDEX "post_metrics_target_fetched" ON "public"."post_metrics" USING btree ("target_id", "fetched_at");
--> statement-breakpoint
ALTER TABLE "public"."post_metrics" ADD CONSTRAINT "post_metrics_target_id_post_targets_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."post_targets"("id") ON DELETE cascade ON UPDATE no action;
