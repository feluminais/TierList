import { createTierList, reduce } from "@tl/core";
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
      schema_version: 1,
    });
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
