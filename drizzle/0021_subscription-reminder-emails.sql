CREATE TABLE "stripe_subscription_reminder_emails" (
	"subscription_id" text NOT NULL,
	"kind" text NOT NULL,
	"attempted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"error" text,
	CONSTRAINT "stripe_subscription_reminder_emails_subscription_id_kind_pk" PRIMARY KEY("subscription_id","kind")
);
--> statement-breakpoint
