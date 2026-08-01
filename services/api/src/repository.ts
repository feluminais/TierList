import { migrate, type TierList } from "@tl/core";
import { and, eq } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { tierLists, type NewTierListRow } from "./schema";

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
  create: (doc: TierList) => Promise<boolean>;
  load: (id: string) => Promise<TierList | null>;
  update: (doc: TierList, expectedRevision: number) => Promise<void>;
}

/** The single place projected columns are derived from the document. */
function toRow(doc: TierList): NewTierListRow {
  return {
    id: doc.id,
    authorId: doc.authorId ?? null,
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
    async create(doc) {
      const inserted = await db
        .insert(tierLists)
        .values(toRow(doc))
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

    // The conflict and the missing-row case deliberately produce the same
    // error: from the client's perspective both mean "your update did not
    // apply, re-read and retry", and distinguishing them would leak whether
    // an id exists.
    async update(doc, expectedRevision) {
      const row = toRow(doc);
      const updated = await db
        .update(tierLists)
        .set(row)
        .where(
          and(
            eq(tierLists.id, doc.id),
            eq(tierLists.revision, expectedRevision),
          ),
        )
        .returning({ id: tierLists.id });

      if (updated.length === 0) {
        throw new RevisionConflictError(doc.id, expectedRevision);
      }
    },
  };
}
