DROP INDEX "device_tokens_hash_idx";--> statement-breakpoint
ALTER TABLE "device_tokens" DROP COLUMN "last_seen_at";