import type { TierList } from "@tl/core";
import {
  boolean,
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
export const deviceTokens = pgTable("device_tokens", {
  id: text("id").primaryKey(),
  // Unique, which is also the index every lookup uses: a token is resolved to
  // an owner by its hash and never by anything else.
  tokenHash: text("token_hash").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

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
    /**
     * When this asset last came into use: when it was uploaded, or when an
     * upload of the same bytes was answered with it. A list's deletion leaves
     * an image alone while it is recent, because a document that is about to
     * be saved may already refer to it and the server cannot see that yet.
     */
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("assets_owner_idx").on(t.ownerId),
    uniqueIndex("assets_owner_checksum_idx").on(t.ownerId, t.checksum),
  ],
);

export type AssetRow = typeof assets.$inferSelect;
export type NewAssetRow = typeof assets.$inferInsert;

/**
 * A public link to a list.
 *
 * The code is the primary key rather than a column beside a surrogate one:
 * every read of a share is by code, and a second identity for the same row
 * would only be a way for the two to disagree.
 *
 * `listId` is unique, so a list has at most one code for its whole life.
 * Re-sharing returns the code that already exists instead of minting a second:
 * a link that has been pasted somewhere must keep working, and two live codes
 * for one list would mean the OG image cached against one of them is silently
 * not the one a reader gets.
 *
 * `ogAssetId` points into `assets` — the same table uploads land in, and
 * therefore the same public, immutable, cache-forever read path. The OG image
 * is rendered by the client through the editor's own Skia canvas and uploaded
 * like any other image; see the route for why that beats rendering it here.
 * Nullable because a share is still a valid, working link before one exists.
 *
 * `ownerId` is denormalised from the list so a re-share can be authorised
 * without loading the whole document.
 */
export const shares = pgTable(
  "shares",
  {
    code: text("code").primaryKey(),
    listId: text("list_id").notNull(),
    ownerId: text("owner_id").notNull(),
    ogAssetId: text("og_asset_id"),
    /**
     * Whether this share appears on browse pages.
     *
     * Separate from having a code at all: "anyone with the link" and "anyone
     * at all" are different offers, and an author who sends a link to two
     * friends has not asked to be indexed. Listing is opted into, and the
     * column lives here rather than on the document because it describes the
     * *share*, not the list — the same list can be private and its published
     * template listed.
     */
    listed: boolean("listed").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex("shares_list_idx").on(t.listId),
    index("shares_listed_idx").on(t.listed),
  ],
);

export type ShareRow = typeof shares.$inferSelect;
export type NewShareRow = typeof shares.$inferInsert;

/**
 * Why a share has been reported.
 *
 * A report is a row an operator reads and acts on; nothing here removes
 * anything by itself. It belongs to a share, so withdrawing the share (the
 * owner's, or an operator's) removes its reports with it: the content they
 * point at is gone.
 *
 * Nothing about the reporter is stored. The endpoint is anonymous and
 * rate-limited, and an address kept beside an accusation is data nobody here
 * needs.
 */
export const reports = pgTable(
  "reports",
  {
    id: text("id").primaryKey(),
    shareCode: text("share_code")
      .notNull()
      .references(() => shares.code, { onDelete: "cascade" }),
    reason: text("reason").notNull(),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    /** Set when an operator has dealt with it; null while it is waiting. */
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [
    index("reports_share_idx").on(t.shareCode),
    index("reports_open_idx").on(t.resolvedAt),
  ],
);

export type ReportRow = typeof reports.$inferSelect;
export type NewReportRow = typeof reports.$inferInsert;
