import { describe, expect, it } from "vitest";
import { createTestDb } from "./pglite";

describe("createTestDb", () => {
  it("provides a working database with the schema applied", async () => {
    const { db, close } = await createTestDb();
    const rows = await db.execute(
      "select table_name from information_schema.tables where table_name = 'tier_lists'",
    );
    expect(rows.rows).toHaveLength(1);
    await close();
  });

  it("gives each caller an isolated database", async () => {
    const a = await createTestDb();
    const b = await createTestDb();

    await a.db.execute(
      "insert into tier_lists (id, title, schema_version, revision, document, created_at, updated_at) " +
        "values ('x', 't', 1, 0, '{}'::jsonb, now(), now())",
    );

    const inA = await a.db.execute("select id from tier_lists");
    const inB = await b.db.execute("select id from tier_lists");

    expect(inA.rows).toHaveLength(1);
    expect(inB.rows).toHaveLength(0);

    await a.close();
    await b.close();
  });
});
