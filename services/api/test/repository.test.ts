import { createTierList, reduce, SCHEMA_VERSION, type TierList } from "@tl/core";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createRepository,
  RevisionConflictError,
  type Repository,
} from "../src/repository";
import { createTestDb, type TestDb } from "./helpers/pglite";

const NOW = "2026-08-01T12:00:00.000Z";
const OWNER = "owner-1";

let ctx: TestDb;
let repo: Repository;

beforeEach(async () => {
  ctx = await createTestDb();
  repo = createRepository(ctx.db);
});

// Each test gets its own in-memory Postgres; without this they accumulate
// for the lifetime of the run.
afterEach(async () => {
  await ctx.close();
});

describe("create and load", () => {
  it("round-trips a document unchanged", async () => {
    const doc = createTierList({ id: "list-1", now: NOW, title: "Ramen" });
    expect(await repo.create(doc, OWNER)).toBe(true);

    const loaded = await repo.load("list-1");
    expect(loaded).toEqual(doc);
  });

  it("returns null for an unknown id", async () => {
    expect(await repo.load("nope")).toBeNull();
  });

  it("projects indexed columns from the document", async () => {
    const doc = createTierList({
      id: "list-1",
      now: NOW,
      title: "Ramen",
      authorId: "user-1",
    });
    await repo.create(doc, OWNER);

    const rows = await ctx.db.execute(
      "select title, author_id, revision, schema_version from tier_lists where id = 'list-1'",
    );
    expect(rows.rows[0]).toMatchObject({
      title: "Ramen",
      author_id: "user-1",
      revision: 0,
      // Asserted against @tl/core's constant rather than a literal, so a
      // version bump does not trip a false alarm here — but against the
      // constant rather than `doc.schemaVersion`, so this still fails if the
      // column is written from anywhere other than the document.
      schema_version: SCHEMA_VERSION,
    });
  });

  /**
   * The assertion above cannot tell `doc.schemaVersion` from the SCHEMA_VERSION
   * constant, because `createTierList` stamps the current version — the two are
   * the same number in every fixture. Only a document whose version differs
   * from the constant separates them, which is what pins the column as a
   * *projection of the document* rather than a second opinion about it.
   */
  it("projects schema_version from the document, not from the current constant", async () => {
    const stale = { ...createTierList({ id: "list-1", now: NOW }), schemaVersion: 1 };
    await repo.create(stale, OWNER);

    const rows = await ctx.db.execute(
      "select schema_version from tier_lists where id = 'list-1'",
    );
    expect(rows.rows[0]).toMatchObject({ schema_version: 1 });
  });

  // create() must never be a back door around the revision check in update().
  it("refuses to overwrite an existing id and leaves the stored document untouched", async () => {
    const first = createTierList({ id: "list-1", now: NOW, title: "Ramen" });
    expect(await repo.create(first, OWNER)).toBe(true);

    const second = createTierList({
      id: "list-1",
      now: NOW,
      title: "Overwritten",
    });
    expect(await repo.create(second, OWNER)).toBe(false);

    const loaded = await repo.load("list-1");
    expect(loaded).toEqual(first);
  });
});

/**
 * `load()` runs every stored document through `migrate()`, and until schema 2
 * there was nothing for it to do — so nothing here had ever exercised the path.
 * It cannot be reached through the repository's own API either: every fixture
 * goes through `createTierList`, which stamps the *current* SCHEMA_VERSION. The
 * row has to be written by hand, the way `helpers/pglite.test.ts` does.
 */
describe("load migrates a document stored at an older schema", () => {
  /**
   * A document damaged the way schema 1 actually damaged them: a row holed by
   * an `item/remove` that dropped a placement without closing the gap behind
   * it, and a tray whose placements are all pinned at index 0 because index 0
   * is all schema 1 ever wrote there.
   */
  async function storeV1(): Promise<void> {
    const document = {
      ...createTierList({ id: "v1-list", now: NOW, title: "Legacy" }),
      schemaVersion: 1,
      items: [
        { id: "a", kind: "text", label: "a", edit: {}, order: 0 },
        { id: "b", kind: "text", label: "b", edit: {}, order: 1 },
        { id: "c", kind: "text", label: "c", edit: {}, order: 2 },
        { id: "d", kind: "text", label: "d", edit: {}, order: 3 },
      ],
      placements: [
        { itemId: "a", rowId: "v1-list-row-0", index: 5 },
        { itemId: "b", rowId: "v1-list-row-0", index: 2 },
        { itemId: "d", rowId: null, index: 0 },
        { itemId: "c", rowId: null, index: 0 },
      ],
    };

    await ctx.db.execute(sql`
      insert into tier_lists
        (id, owner_id, title, schema_version, revision, document, created_at, updated_at)
      values
        ('v1-list', ${OWNER}, 'Legacy', 1, 0,
         ${JSON.stringify(document)}::jsonb, now(), now())
    `);
  }

  const location = (doc: TierList, rowId: string | null): [string, number][] =>
    doc.placements
      .filter((p) => p.rowId === rowId)
      .sort((x, y) => x.index - y.index)
      .map((p) => [p.itemId, p.index]);

  it("returns it at the current schema with contiguous indices everywhere", async () => {
    await storeV1();
    const loaded = await repo.load("v1-list");
    if (!loaded) throw new Error("expected the stored v1 document to load");

    expect(loaded.schemaVersion).toBe(SCHEMA_VERSION);
    // The row keeps the order its indices expressed; the tray, which had none,
    // adopts item `order`.
    expect(location(loaded, "v1-list-row-0")).toEqual([
      ["b", 0],
      ["a", 1],
    ]);
    expect(location(loaded, null)).toEqual([
      ["c", 0],
      ["d", 1],
    ]);
  });

  // Lazily: reading does not write. The migration therefore runs on every read
  // until something updates the document, which is the trade this design makes.
  it("leaves the stored row at its original schema version", async () => {
    await storeV1();
    await repo.load("v1-list");

    const rows = await ctx.db.execute(
      "select schema_version from tier_lists where id = 'v1-list'",
    );
    expect(rows.rows[0]).toMatchObject({ schema_version: 1 });
  });
});

describe("update with optimistic concurrency", () => {
  it("accepts an update whose expected revision matches", async () => {
    const doc = createTierList({ id: "list-1", now: NOW });
    await repo.create(doc, OWNER);

    const next = reduce(
      doc,
      { type: "meta/set", patch: { title: "Ramen" } },
      NOW,
    );
    await repo.update(next, 0, OWNER);

    const loaded = await repo.load("list-1");
    expect(loaded?.title).toBe("Ramen");
    expect(loaded?.revision).toBe(1);
  });

  it("keeps projected columns in step with the document", async () => {
    const doc = createTierList({ id: "list-1", now: NOW, title: "Ramen" });
    await repo.create(doc, OWNER);

    const next = reduce(
      doc,
      { type: "meta/set", patch: { title: "Tonkotsu" } },
      NOW,
    );
    await repo.update(next, 0, OWNER);

    const rows = await ctx.db.execute(
      "select title, revision from tier_lists where id = 'list-1'",
    );
    expect(rows.rows[0]).toMatchObject({ title: "Tonkotsu", revision: 1 });
  });

  it("rejects an update whose expected revision is stale", async () => {
    const doc = createTierList({ id: "list-1", now: NOW });
    await repo.create(doc, OWNER);

    const a = reduce(doc, { type: "meta/set", patch: { title: "A" } }, NOW);
    await repo.update(a, 0, OWNER);

    const b = reduce(doc, { type: "meta/set", patch: { title: "B" } }, NOW);
    await expect(repo.update(b, 0, OWNER)).rejects.toBeInstanceOf(
      RevisionConflictError,
    );
  });

  it("leaves the stored document untouched when it rejects", async () => {
    const doc = createTierList({ id: "list-1", now: NOW });
    await repo.create(doc, OWNER);
    const a = reduce(doc, { type: "meta/set", patch: { title: "A" } }, NOW);
    await repo.update(a, 0, OWNER);

    const b = reduce(doc, { type: "meta/set", patch: { title: "B" } }, NOW);
    await expect(repo.update(b, 0, OWNER)).rejects.toBeInstanceOf(
      RevisionConflictError,
    );

    const loaded = await repo.load("list-1");
    expect(loaded?.title).toBe("A");
  });

  it("rejects an update to a document that does not exist", async () => {
    const doc = createTierList({ id: "ghost", now: NOW });
    await expect(repo.update(doc, 0, OWNER)).rejects.toBeInstanceOf(
      RevisionConflictError,
    );
  });

  /**
   * Pins the ambiguity the route has to work around: a wrong owner is
   * indistinguishable here from a stale revision. Anyone tempted to let the
   * route map this error straight to 404 should read the note on update().
   */
  it("rejects an update from a different owner with the same error as a conflict", async () => {
    const doc = createTierList({ id: "list-1", now: NOW });
    await repo.create(doc, OWNER);

    const next = reduce(
      doc,
      { type: "meta/set", patch: { title: "Hijacked" } },
      NOW,
    );
    await expect(repo.update(next, 0, "stranger")).rejects.toBeInstanceOf(
      RevisionConflictError,
    );

    const loaded = await repo.load("list-1");
    expect(loaded).toEqual(doc);
  });
});

describe("findOwner and listByOwner", () => {
  it("reports the owner of a stored document, and null for an unknown id", async () => {
    await repo.create(createTierList({ id: "list-1", now: NOW }), OWNER);
    expect(await repo.findOwner("list-1")).toBe(OWNER);
    expect(await repo.findOwner("nope")).toBeNull();
  });

  it("returns only the given owner's documents", async () => {
    await repo.create(createTierList({ id: "a", now: NOW, title: "A" }), OWNER);
    await repo.create(
      createTierList({ id: "b", now: NOW, title: "B" }),
      "stranger",
    );

    const mine = await repo.listByOwner(OWNER);
    expect(mine.map((l) => l.id)).toEqual(["a"]);
  });
});
