import type { TierList } from "@tl/core";
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
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
