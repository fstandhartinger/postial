CREATE TABLE "media_tombstones" (
	"id" text PRIMARY KEY NOT NULL,
	"deleted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "offboarding_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid,
	"event" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "request_rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_deletions" (
	"workspace_id" uuid PRIMARY KEY NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "posts" DROP CONSTRAINT "posts_author_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "workspaces" DROP CONSTRAINT "workspaces_owner_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "media_assets" DROP CONSTRAINT "media_assets_uploader_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "posts" ALTER COLUMN "author_user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "media_assets" ALTER COLUMN "uploader_user_id" DROP NOT NULL;--> statement-breakpoint
CREATE INDEX "request_rate_limits_expiry" ON "request_rate_limits" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_uploader_user_id_users_id_fk" FOREIGN KEY ("uploader_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
UPDATE "accounts" SET "access_token"=NULL, "refresh_token"=NULL, "id_token"=NULL;
--> statement-breakpoint
CREATE FUNCTION socialmint_media_deleted() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO media_tombstones (id) VALUES (OLD.id) ON CONFLICT DO NOTHING;
  RETURN OLD;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER media_deleted_tombstone AFTER DELETE ON media_assets FOR EACH ROW EXECUTE FUNCTION socialmint_media_deleted();
