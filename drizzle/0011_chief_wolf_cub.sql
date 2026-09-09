CREATE TABLE "maintenance_runs" (
	"name" text PRIMARY KEY NOT NULL,
	"completed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "last_health_error" text;