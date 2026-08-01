CREATE TABLE "tier_lists" (
	"id" text PRIMARY KEY NOT NULL,
	"author_id" text,
	"title" text NOT NULL,
	"category_id" text,
	"template_id" text,
	"schema_version" integer NOT NULL,
	"revision" integer NOT NULL,
	"document" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "tier_lists_author_idx" ON "tier_lists" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "tier_lists_template_idx" ON "tier_lists" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX "tier_lists_updated_idx" ON "tier_lists" USING btree ("updated_at");