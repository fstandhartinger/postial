CREATE TABLE "public"."postial_visit_daily" (
	"day" date NOT NULL,
	"path" text NOT NULL,
	"referrer_host" text DEFAULT '' NOT NULL,
	"views" integer DEFAULT 0 NOT NULL,
	"visits" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "postial_visit_daily_day_path_referrer_host_pk" PRIMARY KEY("day","path","referrer_host")
);
