CREATE TABLE IF NOT EXISTS "public"."error_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "occurred_at" timestamptz NOT NULL DEFAULT now(),
  "route" text NOT NULL,
  "status" integer,
  "error_class" text NOT NULL,
  "message" text NOT NULL,
  "fingerprint" text NOT NULL,
  "authenticated" boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS "error_events_occurred_at" ON "public"."error_events" ("occurred_at");
CREATE TABLE IF NOT EXISTS "public"."error_event_hourly" (
  "hour" timestamptz PRIMARY KEY,
  "count" integer NOT NULL DEFAULT 0
);
