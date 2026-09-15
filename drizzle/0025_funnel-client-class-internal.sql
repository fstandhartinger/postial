ALTER TABLE "funnel_events" DROP CONSTRAINT IF EXISTS "funnel_events_client_class_check";--> statement-breakpoint
ALTER TABLE "funnel_events" ADD CONSTRAINT "funnel_events_client_class_check" CHECK ("client_class" IN ('browser', 'automated', 'internal', 'unknown'));
