CREATE TABLE IF NOT EXISTS "public"."funnel_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "event" text NOT NULL,
  "day" date NOT NULL,
  "occurred_at" timestamptz NOT NULL DEFAULT now(),
  "workspace_id" uuid REFERENCES "public"."workspaces"("id") ON DELETE SET NULL,
  "path" text,
  "referrer_host" text,
  "props" jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS "funnel_events_event_day" ON "public"."funnel_events" ("event", "day");
CREATE INDEX IF NOT EXISTS "funnel_events_day" ON "public"."funnel_events" ("day");
