import { migrate, type TierList } from "@tl/core";
import { eq } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/pglite";
import { tierLists, type NewTierListRow } from "./schema";

type Db = ReturnType<typeof drizzle>;

export interface Repository {
  save: (doc: TierList) => Promise<void>;
  load: (id: string) => Promise<TierList | null>;
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

export function createRepository(db: Db): Repository {
  return {
    async save(doc) {
      const row = toRow(doc);
      await db
        .insert(tierLists)
        .values(row)
        .onConflictDoUpdate({ target: tierLists.id, set: row });
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
  };
}
