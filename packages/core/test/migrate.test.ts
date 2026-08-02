import { describe, expect, it } from "vitest";
import { createTierList } from "../src/factory";
import { migrate, SchemaTooNewError } from "../src/migrate";
import { DEFAULT_STROKE_WIDTH, SCHEMA_VERSION, type Placement } from "../src/types";

const NOW = "2026-07-31T12:00:00.000Z";

/**
 * Freezes a fixture all the way through, so that any in-place write turns
 * into a TypeError — ES modules are strict mode, where a write to a frozen
 * object throws rather than being silently dropped.
 *
 * This is what turns the first `Migration` rule from a convention into a test.
 * `migrateV1ToV2` returns a structure partly shared with its input —
 * `migrate(doc).items` *is* `doc.items` — so a future step doing
 * `doc.items[0].order = 0` or `doc.placements.sort(...)` would mutate an HTTP
 * request body while every assertion below still passed. The two "does not
 * mutate" tests only sample the fields they happen to name; freezing covers
 * every field, including ones added later.
 */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.values(value as Record<string, unknown>).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

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
    return deepFreeze({
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
    });
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
    return deepFreeze({
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
    });
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

  /**
   * A slot in `placements` is what gets numbered, so the numbering has to be
   * keyed by the slot. Keying it by the placement object means two slots
   * holding the same reference are assigned twice, last write wins: no zero,
   * and a duplicate. `JSON.parse` cannot produce that, but `migrate` is
   * exported, so an in-process caller can.
   */
  it("numbers every slot even when two of them hold the same object", () => {
    const shared = { itemId: "i1", rowId: null, index: 0 };
    const doc = migrate({
      ...createTierList({ id: "list-1", now: NOW }),
      schemaVersion: 1,
      items: [
        { id: "i1", kind: "text", label: "one", edit: {}, order: 0 },
        { id: "i2", kind: "text", label: "two", edit: {}, order: 1 },
      ],
      placements: [shared, shared, { itemId: "i2", rowId: null, index: 0 }],
    });

    expect([...doc.placements].map((p) => p.index).sort()).toEqual([0, 1, 2]);
  });

  it("stamps the document with the new schema version", () => {
    expect(migrate(v1()).schemaVersion).toBe(SCHEMA_VERSION);
  });

  /**
   * The migration touches exactly two fields; nothing checked what happened to
   * the other twelve, so a step that dropped `title`, `rows`, `display`,
   * `boardAnnotations`, `createdAt` or `revision` passed every test here.
   *
   * Asserting on the whole remainder rather than on a list of field names
   * catches a dropped field *and* an invented one, and needs no editing when
   * the model grows a field.
   */
  it("changes nothing in the document but placements and schemaVersion", () => {
    const raw = v1();
    const { placements: _out, schemaVersion: _v, ...migrated } = migrate(raw);
    const { placements: _in, schemaVersion: _w, ...original } = raw;
    expect(migrated).toEqual(original);
    expect(Object.keys(migrated).length).toBeGreaterThan(0);
  });

  /**
   * Replaces an `expect(SCHEMA_VERSION).toBe(2)` change-detector. That worked
   * by forcing an edit on a bump; this asserts the property the edit was
   * supposed to prompt — bumping SCHEMA_VERSION to 3 without registering
   * MIGRATIONS[2] compiles, typechecks, and then throws on the first stored
   * document at schema 2.
   *
   * Behavioural rather than asserting over an exported MIGRATIONS: what
   * matters is that a v-N document opens, not that the registry has a key, and
   * a bare `{schemaVersion: n}` doubles as a check that every registered
   * migration honours the "must not throw on a malformed field" rule.
   */
  it("registers a migration from every version below the current one", () => {
    for (let version = 1; version < SCHEMA_VERSION; version += 1) {
      expect(() => migrate({ schemaVersion: version })).not.toThrow();
      expect(migrate({ schemaVersion: version }).schemaVersion).toBe(SCHEMA_VERSION);
    }
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

describe("schema 2 -> 3: stroke widths are source-relative", () => {
  /** A v2 document with a stroke on an item and one on the board. */
  function v2(): Record<string, unknown> {
    return deepFreeze({
      ...createTierList({ id: "list-1", now: NOW }),
      schemaVersion: 2,
      items: [
        {
          id: "i1",
          kind: "text",
          label: "one",
          order: 0,
          edit: {
            crop: { x: 0, y: 0, w: 1, h: 1 },
            rotation: 0,
            zoom: 1,
            offset: { x: 0, y: 0 },
            strokes: [
              { id: "s1", points: [0, 0, 1, 1], color: "#fff", width: 4 },
              { id: "s2", points: [0, 0, 1, 1], color: "#f00", width: 12 },
            ],
          },
        },
      ],
      placements: [{ itemId: "i1", rowId: null, index: 0 }],
      boardAnnotations: [{ id: "b1", points: [0, 0, 1, 1], color: "#0f0", width: 9 }],
    });
  }

  const widthsOf = (doc: { items: { edit: { strokes: { width: number }[] } }[] }) =>
    doc.items.flatMap((i) => i.edit.strokes.map((s) => s.width));

  it("rewrites every item stroke to the current default width", () => {
    expect(widthsOf(migrate(v2()))).toEqual([DEFAULT_STROKE_WIDTH, DEFAULT_STROKE_WIDTH]);
  });

  it("rewrites board annotations too", () => {
    expect(migrate(v2()).boardAnnotations.map((s) => s.width)).toEqual([
      DEFAULT_STROKE_WIDTH,
    ]);
  });

  it("leaves everything else about a stroke alone", () => {
    const stroke = migrate(v2()).items[0]!.edit.strokes[0]!;
    expect(stroke).toMatchObject({ id: "s1", points: [0, 0, 1, 1], color: "#fff" });
  });

  it("does not mutate the document it was given", () => {
    const raw = v2();
    migrate(raw);
    const items = raw["items"] as { edit: { strokes: { width: number }[] } }[];
    expect(items[0]!.edit.strokes.map((s) => s.width)).toEqual([4, 12]);
  });

  it("survives an item with no edit, or strokes that are not an array", () => {
    const doc = migrate({
      schemaVersion: 2,
      items: [{ id: "a" }, { id: "b", edit: { strokes: "none" } }],
      boardAnnotations: 5,
    });
    expect(doc.schemaVersion).toBe(SCHEMA_VERSION);
  });

  it("carries a v1 document all the way to the current version", () => {
    const doc = migrate({
      schemaVersion: 1,
      items: [
        {
          id: "i1",
          order: 0,
          edit: { strokes: [{ id: "s", points: [0, 0], color: "#fff", width: 4 }] },
        },
      ],
      placements: [{ itemId: "i1", rowId: null, index: 3 }],
    });
    expect(doc.schemaVersion).toBe(SCHEMA_VERSION);
    expect(doc.placements[0]!.index).toBe(0);
    expect(doc.items[0]!.edit.strokes[0]!.width).toBe(DEFAULT_STROKE_WIDTH);
  });
});

/**
 * The `Migration` contract forbids throwing on a malformed field, so every
 * guard in `migrateV1ToV2` has a branch that only a malformed document
 * reaches.
 *
 * Each case states the whole output array, so a change of behaviour in a
 * branch shows up as a diff rather than as a still-passing weaker assertion.
 */
describe("schema 1 -> 2: malformed v1 fields", () => {
  const cases: {
    name: string;
    items?: unknown;
    placements: unknown[];
    expected: unknown[];
  }[] = [
    {
      // Not a record, so unfilable: no location, and no index consumed — the
      // real placement behind them still starts at 0.
      name: "leaves a non-object placement alone and gives it no index",
      items: [{ id: "a", order: 0 }],
      placements: ["junk", null, 42, { itemId: "a", rowId: null, index: 7 }],
      expected: ["junk", null, 42, { itemId: "a", rowId: null, index: 0 }],
    },
    {
      // Filing it would be a guess about which location it belongs to, and
      // renumbering it in place a guess about its neighbours. It keeps the
      // index it arrived with, 42, holed though that leaves things.
      name: "leaves a placement whose rowId is neither string nor null untouched",
      placements: [{ itemId: "a", rowId: 5, index: 42 }],
      expected: [{ itemId: "a", rowId: 5, index: 42 }],
    },
    {
      // Nothing has established that itemIds are unique, so the numbering is
      // keyed by slot. An itemId-keyed map would collapse these to one entry
      // and leave the other slot un-renumbered.
      name: "gives duplicate itemIds in one location distinct indices",
      items: [{ id: "a", order: 0 }],
      placements: [
        { itemId: "a", rowId: "r", index: 3 },
        { itemId: "a", rowId: "r", index: 1 },
      ],
      expected: [
        { itemId: "a", rowId: "r", index: 1 },
        { itemId: "a", rowId: "r", index: 0 },
      ],
    },
    {
      // No item orders are recoverable, so every tray key ties at 0 and the
      // stable sort leaves the array order standing.
      name: "survives items being present but not an array",
      items: { nope: true },
      placements: [
        { itemId: "a", rowId: null, index: 4 },
        { itemId: "b", rowId: null, index: 9 },
      ],
      expected: [
        { itemId: "a", rowId: null, index: 0 },
        { itemId: "b", rowId: null, index: 1 },
      ],
    },
    {
      // `order` is what the tray is renumbered from. An item carrying none
      // falls back to its position in `items`, the only ordering signal left:
      // a is 0, b is 1, so the tray runs a then b.
      name: "falls back to array position for an item with no numeric order",
      items: [{ id: "a", order: "first" }, { id: "b" }],
      placements: [
        { itemId: "b", rowId: null, index: 0 },
        { itemId: "a", rowId: null, index: 0 },
      ],
      expected: [
        { itemId: "b", rowId: null, index: 1 },
        { itemId: "a", rowId: null, index: 0 },
      ],
    },
    {
      // A row is renumbered from its existing indices; a missing or
      // non-numeric one sorts as 0, so b and c tie ahead of a and keep array
      // order. All three are rewritten, so c's string index becomes a number.
      name: "treats a missing or non-numeric index as 0 when ordering a row",
      placements: [
        { itemId: "a", rowId: "r", index: 2 },
        { itemId: "b", rowId: "r" },
        { itemId: "c", rowId: "r", index: "1" },
      ],
      expected: [
        { itemId: "a", rowId: "r", index: 2 },
        { itemId: "b", rowId: "r", index: 0 },
        { itemId: "c", rowId: "r", index: 1 },
      ],
    },
    {
      name: "survives an empty placements array",
      placements: [],
      expected: [],
    },
  ];

  it.each(cases)("$name", ({ items, placements, expected }) => {
    const doc = migrate(
      deepFreeze({ schemaVersion: 1, items: items ?? [], placements }),
    );
    expect(doc.placements).toEqual(expected);
    expect(doc.schemaVersion).toBe(SCHEMA_VERSION);
  });
});
