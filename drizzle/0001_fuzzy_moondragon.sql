CREATE TABLE "stripe_billing_state" (
	"workspace_id" uuid PRIMARY KEY NOT NULL,
	"past_due_since" timestamp with time zone,
	"checkout_session_id" text,
	"checkout_plan" text
);
--> statement-breakpoint
CREATE TABLE "stripe_processed_events" (
	"id" text PRIMARY KEY NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "subscriptions" ALTER COLUMN "status" SET DEFAULT 'incomplete';--> statement-breakpoint
ALTER TABLE "stripe_billing_state" ADD CONSTRAINT "stripe_billing_state_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;