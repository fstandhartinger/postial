CREATE TYPE "public"."approval_decision" AS ENUM('approved', 'changes_requested');--> statement-breakpoint
CREATE TABLE "approval_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"decision" "approval_decision" NOT NULL,
	"comment" text DEFAULT '' NOT NULL,
	"reviewer_name" text NOT NULL,
	"reviewer_ip_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"post_id" uuid NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_rate_limits" ADD CONSTRAINT "approval_rate_limits_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approval_decisions_post_created" ON "approval_decisions" USING btree ("post_id","created_at");