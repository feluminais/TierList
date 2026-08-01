import type { TierList } from "@tl/core";
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * An anonymous device identity. `id` is what lands in tier_lists.owner_id, so a
 * future users table can adopt tokens (by gaining a nullable user_id here)
 * without migrating a single document.
 */
export const deviceTokens = pgTable(
  "device_tokens",
  {
    id: text("id").primaryKey(),
    tokenHash: text("token_hash").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("device_tokens_hash_idx").on(t.tokenHash)],
);

export type DeviceTokenRow = typeof deviceTokens.$inferSelect;
export type NewDeviceTokenRow = typeof deviceTokens.$inferInsert;

/**
 * The `document` column is the source of truth. Every other column is a
 * projection of it, duplicated so that browse, search and "my lists" can be
 * indexed without deserialising every row. Writes must keep them consistent —
 * `toRow()` in repository.ts is the single place that derives them.
 */
export const tierLists = pgTable(
  "tier_lists",
  {
    id: text("id").primaryKey(),
    authorId: text("author_id"),
    ownerId: text("owner_id"),
    title: text("title").notNull(),
    categoryId: text("category_id"),
    templateId: text("template_id"),
    schemaVersion: integer("schema_version").notNull(),
    revision: integer("revision").notNull(),
    document: jsonb("document").$type<TierList>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    index("tier_lists_author_idx").on(t.authorId),
    index("tier_lists_owner_idx").on(t.ownerId),
    index("tier_lists_template_idx").on(t.templateId),
    index("tier_lists_updated_idx").on(t.updatedAt),
  ],
);

export type TierListRow = typeof tierLists.$inferSelect;
export type NewTierListRow = typeof tierLists.$inferInsert;

/**
 * An uploaded image. The bytes live in an ObjectStore under `storageKey`; this
 * row is the metadata and the ownership record.
 *
 * `contentType`, `width` and `height` are what `sniffImage` read out of the
 * bytes themselves — never what the client declared. Storing them means a
 * consumer never has to re-parse an image to lay it out.
 *
 * `checksum` is the SHA-256 of the original bytes. It exists so re-uploading an
 * image the owner already has returns the existing asset instead of storing a
 * second copy, which is an ordinary thing to do when building a tier list.
 * Scoped per owner: two owners uploading identical bytes get two rows and two
 * copies, so neither can affect the other's asset.
 */
export const assets = pgTable(
  "assets",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    storageKey: text("storage_key").notNull(),
    contentType: text("content_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    checksum: text("checksum").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    index("assets_owner_idx").on(t.ownerId),
    uniqueIndex("assets_owner_checksum_idx").on(t.ownerId, t.checksum),
  ],
);

export type AssetRow = typeof assets.$inferSelect;
export type NewAssetRow = typeof assets.$inferInsert;
