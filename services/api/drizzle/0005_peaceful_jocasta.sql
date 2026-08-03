ALTER TABLE "shares" ADD COLUMN "listed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "shares_listed_idx" ON "shares" USING btree ("listed");