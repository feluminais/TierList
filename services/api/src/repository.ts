import { migrate, type TierList } from "@tl/core";
import { and, desc, eq, ilike, inArray } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import {
  assets,
  deviceTokens,
  shares,
  tierLists,
  type AssetRow,
  type NewAssetRow,
  type NewShareRow,
  type NewTierListRow,
  type ShareRow,
} from "./schema";

/**
 * The driver-agnostic base both Drizzle Postgres drivers extend:
 * `PgliteDatabase` (tests) and `NodePgDatabase` (production) are each declared
 * as `PgDatabase<TheirOwnQueryResultHKT, TSchema>`, and both query-result HKTs
 * extend `PgQueryResultHKT`. Typing against the base rather than one driver is
 * what makes testing on PGlite meaningful: the repository is compiled against
 * exactly the surface both drivers agree on, so a difference between them would
 * surface here as a type error rather than at runtime in production.
 *
 * `Record<string, unknown>` is the schema parameter's own constraint. The
 * repository uses only the core query builder, never the relational `db.query`
 * API, so it is indifferent to which schema a caller registered.
 */
type Db = PgDatabase<PgQueryResultHKT, Record<string, unknown>>;

export interface Repository {
  /**
   * Inserts a new document. Returns false, changing nothing, when the id is
   * already taken. Deliberately not an upsert: an overwriting create would be
   * a way to clobber a document without presenting a revision, which is
   * exactly what `update` exists to prevent.
   */
  create: (doc: TierList, ownerId: string, now?: Date) => Promise<boolean>;
  load: (id: string) => Promise<TierList | null>;
  update: (
    doc: TierList,
    expectedRevision: number,
    ownerId: string,
    now?: Date,
  ) => Promise<void>;
  /**
   * The owner of a stored document, or null when the id is unknown. Exists so a
   * route can tell "not yours" from "stale revision" *before* attempting an
   * update — see the comment on `update` for why those must not collapse.
   */
  findOwner: (id: string) => Promise<string | null>;
  listByOwner: (
    ownerId: string,
  ) => Promise<{ id: string; title: string; updatedAt: Date }[]>;
  /** Stores a minted token by its hash. The raw token never reaches here. */
  createToken: (id: string, tokenHash: string, now: Date) => Promise<void>;
  findTokenId: (tokenHash: string) => Promise<string | null>;
  /**
   * Records an upload whose bytes are already in the object store. Returns
   * false, changing nothing, when the owner already holds an asset with the
   * same checksum — the loser of a race between two identical uploads.
   */
  createAsset: (row: NewAssetRow) => Promise<boolean>;
  findAsset: (id: string) => Promise<AssetRow | null>;
  /**
   * An owner's existing asset with these exact bytes, if any. Scoped to the
   * owner so no two owners ever share a storage key.
   */
  findAssetByChecksum: (ownerId: string, checksum: string) => Promise<AssetRow | null>;
  /**
   * The intrinsic sizes of several assets at once, by id.
   *
   * Exists for the public share page, which has to lay an image out *without*
   * decoding it — and cannot, from the document alone: a crop is a fraction of
   * the source, so what the tile shows depends on the source's own aspect
   * ratio. One query rather than one request per tile is the difference
   * between a page that opens fast and one that does not.
   *
   * Deliberately not scoped to an owner: a reader of a shared list is not its
   * owner, and these are exactly the assets that endpoint already serves
   * publicly.
   */
  findAssetSizes: (
    ids: readonly string[],
  ) => Promise<{ id: string; width: number; height: number }[]>;
  /**
   * Claims a share code. Returns false, changing nothing, when the code is
   * already taken — so the caller can generate another and try again rather
   * than take a 500 on a collision it is entitled to lose.
   *
   * Deliberately not an upsert on `listId` either: a second row for a list
   * that already has one must fail, because a list's code must never change
   * once it has been pasted somewhere.
   */
  createShare: (row: NewShareRow) => Promise<boolean>;
  findShareByCode: (code: string) => Promise<ShareRow | null>;
  findShareByList: (listId: string) => Promise<ShareRow | null>;
  /** Points an existing share at a (re-rendered) OG image. */
  setShareOgAsset: (code: string, ogAssetId: string) => Promise<void>;
  /** Opts a share into, or out of, appearing on browse pages. */
  setShareListed: (code: string, listed: boolean) => Promise<void>;
  /**
   * Publicly listed shares, newest first.
   *
   * Reads the projected columns rather than the documents: browse shows a
   * title, a category and a picture, and deserialising every stored document
   * to render a grid is what those columns exist to avoid.
   */
  browse: (query: BrowseQuery) => Promise<BrowseRow[]>;
}

/**
 * The single place projected columns are derived from the document.
 *
 * The row's timestamps are deliberately not among them. `createdAt` and
 * `updatedAt` inside the document are the author's clock and belong to the
 * model; the columns are the server's record of when it stored the row, and
 * they order browse and "my lists". A client-supplied time there would let any
 * author pin a list to the top of a public page by dating it in the future.
 */
function projected(doc: TierList): Omit<NewTierListRow, "ownerId" | "createdAt" | "updatedAt"> {
  return {
    id: doc.id,
    authorId: doc.authorId ?? null,
    title: doc.title,
    categoryId: doc.categoryId,
    templateId: doc.templateId ?? null,
    schemaVersion: doc.schemaVersion,
    revision: doc.revision,
    document: doc,
  };
}

/**
 * Escape the characters `LIKE` treats as syntax.
 *
 * Parameterising the value keeps it out of the SQL text, which stops
 * injection — but it does *not* stop `%` and `_` inside that value from being
 * read as wildcards, so a search for "%" would match every row and a search
 * for "a_c" would match "abc". Postgres reads a backslash as the escape
 * character in a `LIKE` pattern unless told otherwise, so escaping these three
 * makes the user's text mean itself. The backslash goes first, or it would
 * escape the escapes added after it.
 */
function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (match) => `\\${match}`);
}

export interface BrowseQuery {
  /** A category id, or null for every category. */
  categoryId?: string | null;
  /** Free text matched against the title, case-insensitively. */
  text?: string | null;
  limit: number;
}

export interface BrowseRow {
  code: string;
  listId: string;
  title: string;
  categoryId: string | null;
  ogAssetId: string | null;
  updatedAt: Date;
}

export class RevisionConflictError extends Error {
  constructor(
    readonly id: string,
    readonly expected: number,
  ) {
    super(
      `Tier list ${id} was modified by someone else (expected revision ${expected}).`,
    );
    this.name = "RevisionConflictError";
  }
}

export function createRepository(db: Db): Repository {
  return {
    async create(doc, ownerId, now = new Date()) {
      const inserted = await db
        .insert(tierLists)
        .values({ ...projected(doc), ownerId, createdAt: now, updatedAt: now })
        .onConflictDoNothing({ target: tierLists.id })
        .returning({ id: tierLists.id });

      return inserted.length > 0;
    },

    async load(id) {
      const rows = await db
        .select()
        .from(tierLists)
        .where(eq(tierLists.id, id))
        .limit(1);

      const row = rows[0];
      if (!row) return null;

      // migrate() is the only thing that decides what a stored document means.
      return migrate(row.document);
    },

    /**
     * Three different failures all match zero rows here — unknown id, stale
     * revision, wrong owner — and all raise the same RevisionConflictError.
     * That is fine at this layer but *not* at the HTTP layer: 409 means
     * "re-read and retry" and 404 means "stop", and telling an owner with a
     * genuine conflict to stop loses their write silently. Routes therefore
     * establish ownership with `findOwner` before calling this, so a conflict
     * reaching them can only mean a stale revision.
     */
    async update(doc, expectedRevision, ownerId, now = new Date()) {
      const updated = await db
        .update(tierLists)
        .set({ ...projected(doc), updatedAt: now })
        .where(
          and(
            eq(tierLists.id, doc.id),
            eq(tierLists.revision, expectedRevision),
            eq(tierLists.ownerId, ownerId),
          ),
        )
        .returning({ id: tierLists.id });

      if (updated.length === 0) {
        throw new RevisionConflictError(doc.id, expectedRevision);
      }
    },

    async findOwner(id) {
      const rows = await db
        .select({ ownerId: tierLists.ownerId })
        .from(tierLists)
        .where(eq(tierLists.id, id))
        .limit(1);

      return rows[0]?.ownerId ?? null;
    },

    async listByOwner(ownerId) {
      return db
        .select({
          id: tierLists.id,
          title: tierLists.title,
          updatedAt: tierLists.updatedAt,
        })
        .from(tierLists)
        .where(eq(tierLists.ownerId, ownerId))
        .orderBy(desc(tierLists.updatedAt));
    },

    async createToken(id, tokenHash, now) {
      await db.insert(deviceTokens).values({ id, tokenHash, createdAt: now });
    },

    async findTokenId(tokenHash) {
      const rows = await db
        .select({ id: deviceTokens.id })
        .from(deviceTokens)
        .where(eq(deviceTokens.tokenHash, tokenHash))
        .limit(1);

      return rows[0]?.id ?? null;
    },

    async createAsset(row) {
      const inserted = await db
        .insert(assets)
        .values(row)
        .onConflictDoNothing({ target: [assets.ownerId, assets.checksum] })
        .returning({ id: assets.id });
      return inserted.length > 0;
    },

    async findAsset(id) {
      const rows = await db.select().from(assets).where(eq(assets.id, id)).limit(1);
      return rows[0] ?? null;
    },

    async findAssetByChecksum(ownerId, checksum) {
      const rows = await db
        .select()
        .from(assets)
        .where(and(eq(assets.ownerId, ownerId), eq(assets.checksum, checksum)))
        .limit(1);
      return rows[0] ?? null;
    },

    async findAssetSizes(ids) {
      // `inArray` with an empty list builds `in ()`, which is a syntax error in
      // Postgres. A document with no image tiles is entirely ordinary.
      if (ids.length === 0) return [];
      return db
        .select({ id: assets.id, width: assets.width, height: assets.height })
        .from(assets)
        .where(inArray(assets.id, [...ids]));
    },

    async createShare(row) {
      // Targeted at the code alone. A conflict on `listId` — a second share for
      // a list that already has one — is *not* something to swallow: it means
      // the caller skipped the read that should have found the existing code,
      // and silently doing nothing would return a code that names another row.
      const inserted = await db
        .insert(shares)
        .values(row)
        .onConflictDoNothing({ target: shares.code })
        .returning({ code: shares.code });
      return inserted.length > 0;
    },

    async findShareByCode(code) {
      const rows = await db.select().from(shares).where(eq(shares.code, code)).limit(1);
      return rows[0] ?? null;
    },

    async findShareByList(listId) {
      const rows = await db.select().from(shares).where(eq(shares.listId, listId)).limit(1);
      return rows[0] ?? null;
    },

    async setShareOgAsset(code, ogAssetId) {
      await db.update(shares).set({ ogAssetId }).where(eq(shares.code, code));
    },

    async setShareListed(code, listed) {
      await db.update(shares).set({ listed }).where(eq(shares.code, code));
    },

    async browse({ categoryId, text, limit }) {
      const conditions = [eq(shares.listed, true)];
      if (categoryId) conditions.push(eq(tierLists.categoryId, categoryId));
      if (text) {
        // `ilike` rather than a text-search index: the corpus is small, this
        // is one indexable column, and a real ranking function is a decision
        // to make when there is enough content for ranking to mean anything.
        conditions.push(ilike(tierLists.title, `%${escapeLike(text)}%`));
      }

      return db
        .select({
          code: shares.code,
          listId: tierLists.id,
          title: tierLists.title,
          categoryId: tierLists.categoryId,
          ogAssetId: shares.ogAssetId,
          updatedAt: tierLists.updatedAt,
        })
        .from(shares)
        .innerJoin(tierLists, eq(tierLists.id, shares.listId))
        .where(and(...conditions))
        .orderBy(desc(tierLists.updatedAt))
        .limit(limit);
    },
  };
}
