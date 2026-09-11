ALTER TABLE "funnel_events" ADD COLUMN "client_class" text NOT NULL DEFAULT 'unknown';
ALTER TABLE "funnel_events" ADD CONSTRAINT "funnel_events_client_class_check" CHECK ("client_class" IN ('browser', 'automated', 'unknown'));
