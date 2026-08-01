import { describe, expect, it } from "vitest";
import { createTierList, defaultImageEdit } from "../src/factory";
import { reduce } from "../src/reduce";

const NOW = "2026-07-31T12:00:00.000Z";
const LATER = "2026-07-31T13:00:00.000Z";

function base() {
  return createTierList({ id: "list-1", now: NOW });
}

describe("reduce — bookkeeping", () => {
  it("bumps revision and updatedAt on every change", () => {
    const next = reduce(base(), { type: "row/rename", rowId: "list-1-row-0", label: "God" }, LATER);
    expect(next.revision).toBe(1);
    expect(next.updatedAt).toBe(LATER);
  });

  it("does not mutate the input document", () => {
    const doc = base();
    reduce(doc, { type: "row/rename", rowId: "list-1-row-0", label: "God" }, LATER);
    expect(doc.rows[0]!.label).toBe("S");
    expect(doc.revision).toBe(0);
  });
});

describe("reduce — row/add", () => {
  it("appends a row at the end", () => {
    const next = reduce(base(), { type: "row/add", id: "row-new", label: "F", color: "#888888" }, LATER);
    expect(next.rows).toHaveLength(6);
    expect(next.rows[5]).toMatchObject({ id: "row-new", label: "F", order: 5 });
  });
});

describe("reduce — row/rename and row/recolor", () => {
  it("renames only the target row", () => {
    const next = reduce(base(), { type: "row/rename", rowId: "list-1-row-1", label: "Great" }, LATER);
    expect(next.rows[1]!.label).toBe("Great");
    expect(next.rows[0]!.label).toBe("S");
  });

  it("recolors only the target row", () => {
    const next = reduce(base(), { type: "row/recolor", rowId: "list-1-row-1", color: "#000000" }, LATER);
    expect(next.rows[1]!.color).toBe("#000000");
  });

  it("is a no-op for an unknown row id", () => {
    const doc = base();
    const next = reduce(doc, { type: "row/rename", rowId: "nope", label: "X" }, LATER);
    expect(next.rows).toEqual(doc.rows);
  });
});

describe("reduce — row/remove", () => {
  it("removes the row and renumbers the rest", () => {
    const next = reduce(base(), { type: "row/remove", rowId: "list-1-row-1" }, LATER);
    expect(next.rows.map((r) => r.label)).toEqual(["S", "B", "C", "D"]);
    expect(next.rows.map((r) => r.order)).toEqual([0, 1, 2, 3]);
  });

  it("returns items in the removed row to the tray rather than deleting them", () => {
    let doc = base();
    doc = reduce(doc, { type: "item/addText", id: "i1", label: "Tonkotsu" }, LATER);
    doc = reduce(doc, { type: "placement/place", itemId: "i1", rowId: "list-1-row-1", index: 0 }, LATER);
    const next = reduce(doc, { type: "row/remove", rowId: "list-1-row-1" }, LATER);

    expect(next.items).toHaveLength(1);
    expect(next.placements).toHaveLength(1);
    expect(next.placements[0]).toMatchObject({ itemId: "i1", rowId: null });
  });

  it("appends the returned items to the end of the tray, keeping its indices contiguous", () => {
    let doc = base();
    for (const id of ["i1", "i2", "i3", "i4"]) {
      doc = reduce(doc, { type: "item/addText", id, label: id }, LATER);
    }
    const row = "list-1-row-1";
    doc = reduce(doc, { type: "placement/place", itemId: "i1", rowId: row, index: 0 }, LATER);
    doc = reduce(doc, { type: "placement/place", itemId: "i2", rowId: row, index: 1 }, LATER);
    doc = reduce(doc, { type: "placement/place", itemId: "i3", rowId: row, index: 2 }, LATER);
    doc = reduce(doc, { type: "row/remove", rowId: row }, LATER);

    const tray = doc.placements
      .filter((p) => p.rowId === null)
      .sort((a, b) => a.index - b.index);
    // i4 never left the tray; i1..i3 land after it, in the order they held in the row.
    expect(tray.map((p) => p.itemId)).toEqual(["i4", "i1", "i2", "i3"]);
    expect(tray.map((p) => p.index)).toEqual([0, 1, 2, 3]);
  });
});

describe("reduce — row/reorder", () => {
  it("moves a row to a new index and renumbers", () => {
    const next = reduce(base(), { type: "row/reorder", rowId: "list-1-row-0", toIndex: 2 }, LATER);
    expect(next.rows.map((r) => r.label)).toEqual(["A", "B", "S", "C", "D"]);
    expect(next.rows.map((r) => r.order)).toEqual([0, 1, 2, 3, 4]);
  });

  it("clamps an out-of-range target index", () => {
    const next = reduce(base(), { type: "row/reorder", rowId: "list-1-row-0", toIndex: 99 }, LATER);
    expect(next.rows.map((r) => r.label)).toEqual(["A", "B", "C", "D", "S"]);
  });
});

describe("reduce — misses are genuine no-ops", () => {
  it("does not bump revision when the target row does not exist", () => {
    const doc = base();
    const next = reduce(doc, { type: "row/rename", rowId: "nope", label: "X" }, LATER);
    expect(next).toBe(doc);
  });

  it("does not bump revision when removing an item that does not exist", () => {
    const doc = base();
    const next = reduce(doc, { type: "item/remove", itemId: "nope" }, LATER);
    expect(next).toBe(doc);
  });

  it("does not bump revision when recoloring a row that does not exist", () => {
    const doc = base();
    const next = reduce(doc, { type: "row/recolor", rowId: "nope", color: "#000000" }, LATER);
    expect(next).toBe(doc);
  });

  it("does not bump revision when removing a row that does not exist", () => {
    const doc = base();
    const next = reduce(doc, { type: "row/remove", rowId: "nope" }, LATER);
    expect(next).toBe(doc);
  });

  it("does not bump revision when editing an item that does not exist", () => {
    const doc = base();
    const next = reduce(
      doc,
      { type: "item/setEdit", itemId: "nope", edit: defaultImageEdit() },
      LATER,
    );
    expect(next).toBe(doc);
  });

  it("does not bump revision when reordering a row that does not exist", () => {
    const doc = base();
    const next = reduce(doc, { type: "row/reorder", rowId: "nope", toIndex: 0 }, LATER);
    expect(next).toBe(doc);
  });

  it("does not bump revision when unplacing an item that does not exist", () => {
    const doc = base();
    const next = reduce(doc, { type: "placement/unplace", itemId: "nope" }, LATER);
    expect(next).toBe(doc);
  });

  it("still bumps revision when the target does exist", () => {
    const doc = base();
    const next = reduce(doc, { type: "row/rename", rowId: "list-1-row-0", label: "God" }, LATER);
    expect(next).not.toBe(doc);
    expect(next.revision).toBe(1);
  });
});
