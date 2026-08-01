CREATE TABLE "device_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	CONSTRAINT "device_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "tier_lists" ADD COLUMN "owner_id" text;--> statement-breakpoint
CREATE INDEX "device_tokens_hash_idx" ON "device_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "tier_lists_owner_idx" ON "tier_lists" USING btree ("owner_id");