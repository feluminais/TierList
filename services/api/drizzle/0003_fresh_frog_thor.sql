CREATE TABLE "shares" (
	"code" text PRIMARY KEY NOT NULL,
	"list_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"og_asset_id" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "shares_list_idx" ON "shares" USING btree ("list_id");