import { migrate, type TierList } from "@tl/core";
import { and, desc, eq } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { deviceTokens, tierLists, type NewTierListRow } from "./schema";

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
  create: (doc: TierList, ownerId: string) => Promise<boolean>;
  load: (id: string) => Promise<TierList | null>;
  update: (
    doc: TierList,
    expectedRevision: number,
    ownerId: string,
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
}

/** The single place projected columns are derived from the document. */
function toRow(doc: TierList, ownerId: string): NewTierListRow {
  return {
    id: doc.id,
    authorId: doc.authorId ?? null,
    ownerId,
    title: doc.title,
    categoryId: doc.categoryId,
    templateId: doc.templateId ?? null,
    schemaVersion: doc.schemaVersion,
    revision: doc.revision,
    document: doc,
    createdAt: new Date(doc.createdAt),
    updatedAt: new Date(doc.updatedAt),
  };
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
    async create(doc, ownerId) {
      const inserted = await db
        .insert(tierLists)
        .values(toRow(doc, ownerId))
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
    async update(doc, expectedRevision, ownerId) {
      const row = toRow(doc, ownerId);
      const updated = await db
        .update(tierLists)
        .set(row)
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
      await db.insert(deviceTokens).values({
        id,
        tokenHash,
        createdAt: now,
        lastSeenAt: now,
      });
    },

    async findTokenId(tokenHash) {
      const rows = await db
        .select({ id: deviceTokens.id })
        .from(deviceTokens)
        .where(eq(deviceTokens.tokenHash, tokenHash))
        .limit(1);

      return rows[0]?.id ?? null;
    },
  };
}
