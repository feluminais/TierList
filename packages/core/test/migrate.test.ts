import { describe, expect, it } from "vitest";
import { createTierList } from "../src/factory";
import { migrate, SchemaTooNewError } from "../src/migrate";
import { SCHEMA_VERSION, type Placement } from "../src/types";

const NOW = "2026-07-31T12:00:00.000Z";

describe("migrate", () => {
  it("returns a current-version document unchanged", () => {
    const doc = createTierList({ id: "list-1", now: NOW });
    expect(migrate(doc)).toEqual(doc);
  });

  it("throws SchemaTooNewError for a document from a newer client", () => {
    const doc = { ...createTierList({ id: "list-1", now: NOW }), schemaVersion: SCHEMA_VERSION + 1 };
    expect(() => migrate(doc)).toThrow(SchemaTooNewError);
  });

  it("names both versions in the error so the message is actionable", () => {
    const doc = { ...createTierList({ id: "list-1", now: NOW }), schemaVersion: 99 };
    expect(() => migrate(doc)).toThrow(/99/);
    expect(() => migrate(doc)).toThrow(new RegExp(String(SCHEMA_VERSION)));
  });

  it("rejects a value that is not an object", () => {
    expect(() => migrate(null)).toThrow(/not a tier list/i);
    expect(() => migrate("nope")).toThrow(/not a tier list/i);
  });

  it("rejects an object with no schemaVersion", () => {
    expect(() => migrate({ id: "x" })).toThrow(/schemaVersion/i);
  });
});

describe("schema 1 -> 2: contiguous placement indices", () => {
  /** A v1 document: every tray placement pinned at index 0. */
  function v1(): Record<string, unknown> {
    return {
      ...createTierList({ id: "list-1", now: NOW }),
      schemaVersion: 1,
      items: [
        { id: "i1", kind: "text", label: "one", edit: {}, order: 0 },
        { id: "i2", kind: "text", label: "two", edit: {}, order: 1 },
        { id: "i3", kind: "text", label: "three", edit: {}, order: 2 },
      ],
      placements: [
        { itemId: "i3", rowId: null, index: 0 },
        { itemId: "i1", rowId: null, index: 0 },
        { itemId: "i2", rowId: "list-1-row-0", index: 0 },
      ],
    };
  }

  it("renumbers tray placements into a contiguous sequence ordered by item order", () => {
    const doc = migrate(v1());
    const tray = doc.placements
      .filter((p) => p.rowId === null)
      .sort((a, b) => a.index - b.index);
    expect(tray.map((p) => p.itemId)).toEqual(["i1", "i3"]);
    expect(tray.map((p) => p.index)).toEqual([0, 1]);
  });

  // Renumbering the tray must not relocate anything: an item in a row stays
  // in its row, and being the only thing there it keeps index 0.
  it("does not pull a row placement into the tray", () => {
    const doc = migrate(v1());
    const inRow = doc.placements.find((p) => p.itemId === "i2");
    expect(inRow).toMatchObject({ rowId: "list-1-row-0", index: 0 });
  });

  /**
   * A v1 document whose rows are malformed in the three ways the schema 1
   * reducer could actually produce: a hole (`item/remove` and a cross-row
   * `place` both left one), and indices that never reach 0 (closing a hole
   * below the vacated slot shifted the survivors down but not to the front).
   */
  function v1HoledRows(): Record<string, unknown> {
    return {
      ...createTierList({ id: "list-1", now: NOW }),
      schemaVersion: 1,
      items: [
        { id: "a", kind: "text", label: "a", edit: {}, order: 0 },
        { id: "b", kind: "text", label: "b", edit: {}, order: 1 },
        { id: "c", kind: "text", label: "c", edit: {}, order: 2 },
        { id: "d", kind: "text", label: "d", edit: {}, order: 3 },
      ],
      placements: [
        // Holed, and deliberately listed out of index order.
        { itemId: "c", rowId: "list-1-row-0", index: 5 },
        { itemId: "a", rowId: "list-1-row-0", index: 9 },
        { itemId: "b", rowId: "list-1-row-0", index: 2 },
        // Contiguous but never reaching 0.
        { itemId: "d", rowId: "list-1-row-1", index: 3 },
      ],
    };
  }

  const inRow = (doc: { placements: Placement[] }, rowId: string): Placement[] =>
    doc.placements.filter((p) => p.rowId === rowId).sort((x, y) => x.index - y.index);

  it("closes the holes in a row, preserving the order the indices expressed", () => {
    const row = inRow(migrate(v1HoledRows()), "list-1-row-0");
    expect(row.map((p) => p.itemId)).toEqual(["b", "c", "a"]);
    expect(row.map((p) => p.index)).toEqual([0, 1, 2]);
  });

  // The row above orders as b, c, a by index but a, b, c by item `order`, so
  // this fails if a row is renumbered off `order` the way the tray is.
  it("orders a row by its existing indices, not by item order", () => {
    const row = inRow(migrate(v1HoledRows()), "list-1-row-0");
    expect(row.map((p) => p.itemId)).not.toEqual(["a", "b", "c"]);
  });

  it("pulls a row whose indices never reach 0 down to the front", () => {
    const row = inRow(migrate(v1HoledRows()), "list-1-row-1");
    expect(row.map((p) => p.index)).toEqual([0]);
  });

  it("renumbers each row independently of the others", () => {
    const doc = migrate(v1HoledRows());
    expect(inRow(doc, "list-1-row-0").map((p) => p.index)).toEqual([0, 1, 2]);
    expect(inRow(doc, "list-1-row-1").map((p) => p.index)).toEqual([0]);
  });

  it("does not mutate a document whose rows it renumbered", () => {
    const raw = v1HoledRows();
    migrate(raw);
    expect((raw["placements"] as { index: number }[]).map((p) => p.index)).toEqual([5, 9, 2, 3]);
  });

  /**
   * `typeof [] === "object"`, so a helper narrowing on that alone files an
   * array as a placement. Two harms: the `{ ...p, index }` spread converts it
   * to a plain object, and — having no string `rowId` — it is filed into the
   * tray, where it consumes index 0 and leaves the location's only real
   * placement starting at 1. Reachable straight from JSON, so from a request
   * body.
   */
  it("leaves an array inside placements alone and lets it consume no index", () => {
    const doc = migrate({
      ...createTierList({ id: "list-1", now: NOW }),
      schemaVersion: 1,
      items: [{ id: "i1", kind: "text", label: "one", edit: {}, order: 0 }],
      placements: [["junk"], { itemId: "i1", rowId: null, index: 0 }],
    });

    expect(Array.isArray(doc.placements[0])).toBe(true);
    expect(doc.placements[0]).toEqual(["junk"]);
    expect(doc.placements[1]).toEqual({ itemId: "i1", rowId: null, index: 0 });
  });

  it("stamps the document with the new schema version", () => {
    expect(migrate(v1()).schemaVersion).toBe(SCHEMA_VERSION);
    expect(SCHEMA_VERSION).toBe(2);
  });

  it("does not mutate the document it was given", () => {
    const raw = v1();
    migrate(raw);
    expect(raw["schemaVersion"]).toBe(1);
    expect((raw["placements"] as { index: number }[]).map((p) => p.index)).toEqual([0, 0, 0]);
  });

  it("survives a v1 document whose items or placements are missing", () => {
    const bare = { schemaVersion: 1 };
    expect(() => migrate(bare)).not.toThrow();
    expect(migrate(bare).schemaVersion).toBe(SCHEMA_VERSION);
  });

  // The case above passes even if migrate() stamps the caller's object in
  // place, because a mutated `bare` reads back as already-current. A migration
  // with nothing to change may hand its input straight back, so the version
  // stamp — not the migration — is what has to avoid writing through.
  it("does not mutate a document its migration returned untouched", () => {
    const bare: Record<string, unknown> = { schemaVersion: 1 };
    migrate(bare);
    expect(bare["schemaVersion"]).toBe(1);
  });
});
