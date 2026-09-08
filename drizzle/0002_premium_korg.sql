CREATE TABLE "stripe_retired_subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "trial_used_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "stripe_billing_state" ADD COLUMN "checkout_lease" text;--> statement-breakpoint
ALTER TABLE "stripe_billing_state" ADD COLUMN "checkout_lease_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "stripe_retired_subscriptions" ADD CONSTRAINT "stripe_retired_subscriptions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
UPDATE "workspaces" SET "trial_used_at" = COALESCE("subscriptions"."trial_end", "subscriptions"."updated_at")
FROM "subscriptions" WHERE "subscriptions"."workspace_id" = "workspaces"."id"
AND "subscriptions"."stripe_subscription_id" IS NOT NULL;
