import { describe, expect, it } from "vitest";
import { createTierList } from "../src/factory";
import { migrate, SchemaTooNewError } from "../src/migrate";
import { SCHEMA_VERSION } from "../src/types";

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

describe("schema 1 -> 2: tray ordering", () => {
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

  it("leaves placements that are in a row alone", () => {
    const doc = migrate(v1());
    const inRow = doc.placements.find((p) => p.itemId === "i2");
    expect(inRow).toMatchObject({ rowId: "list-1-row-0", index: 0 });
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
