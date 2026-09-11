CREATE TABLE "channel_alert_emails" (
	"workspace_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"post_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"pending" boolean DEFAULT true NOT NULL,
	"attempted_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"error" text,
	CONSTRAINT "channel_alert_emails_workspace_id_channel_id_kind_pk" PRIMARY KEY("workspace_id","channel_id","kind")
);
--> statement-breakpoint
ALTER TABLE "channel_alert_emails" ADD CONSTRAINT "channel_alert_emails_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "channel_alert_emails" ADD CONSTRAINT "channel_alert_emails_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;
