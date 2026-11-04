CREATE TABLE "reports" (
	"id" text PRIMARY KEY NOT NULL,
	"share_code" text NOT NULL,
	"reason" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_share_code_shares_code_fk" FOREIGN KEY ("share_code") REFERENCES "public"."shares"("code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reports_share_idx" ON "reports" USING btree ("share_code");--> statement-breakpoint
CREATE INDEX "reports_open_idx" ON "reports" USING btree ("resolved_at");