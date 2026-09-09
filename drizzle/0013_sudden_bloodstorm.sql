CREATE TABLE "network_waitlist" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"network" text NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_hash" text NOT NULL,
	"source" text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "network_waitlist_network_email_unique" ON "network_waitlist" USING btree ("network","email");--> statement-breakpoint
CREATE INDEX "network_waitlist_ip_created_idx" ON "network_waitlist" USING btree ("ip_hash","created_at");