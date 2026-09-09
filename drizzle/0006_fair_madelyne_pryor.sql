CREATE TABLE "api_idempotency" (
	"key_id" uuid NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"response" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "api_idempotency_key_id_key_pk" PRIMARY KEY("key_id","key")
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"key_prefix" text NOT NULL,
	"key_hash" text NOT NULL,
	"scopes" text[] NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_by_user_id" text NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE "api_rate_limits" (
	"key_id" uuid PRIMARY KEY NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"endpoint_id" uuid NOT NULL,
	"event" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now(),
	"response_status" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_endpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"url" text NOT NULL,
	"secret_hash" text NOT NULL,
	"secret_enc" text NOT NULL,
	"events" text[] NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_idempotency" ADD CONSTRAINT "api_idempotency_key_id_api_keys_id_fk" FOREIGN KEY ("key_id") REFERENCES "public"."api_keys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_rate_limits" ADD CONSTRAINT "api_rate_limits_key_id_api_keys_id_fk" FOREIGN KEY ("key_id") REFERENCES "public"."api_keys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_endpoint_id_webhook_endpoints_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."webhook_endpoints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_idempotency_expiry" ON "api_idempotency" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_due" ON "webhook_deliveries" USING btree ("status","next_attempt_at");