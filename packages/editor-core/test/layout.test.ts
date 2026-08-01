import { createTierList, reduce, type Density, type TierList } from "@tl/core";
import { describe, expect, it } from "vitest";
import { layoutBoard } from "../src/layout";

const NOW = "2026-08-01T12:00:00.000Z";
const S = "list-1-row-0";
const A = "list-1-row-1";

/** A list with `count` text items, all sitting in the tray. */
function withItems(count: number): TierList {
  let doc = createTierList({ id: "list-1", now: NOW });
  for (let i = 0; i < count; i += 1) {
    doc = reduce(doc, { type: "item/addText", id: `i${i}`, label: `i${i}` }, NOW);
  }
  return doc;
}

describe("layoutBoard", () => {
  it("emits one box per row, in row order, stacked without gaps or overlaps", () => {
    const layout = layoutBoard(withItems(0), { width: 800 });

    expect(layout.rows.map((r) => r.rowId)).toEqual([
      "list-1-row-0",
      "list-1-row-1",
      "list-1-row-2",
      "list-1-row-3",
      "list-1-row-4",
    ]);

    for (let i = 1; i < layout.rows.length; i += 1) {
      const previous = layout.rows[i - 1]!;
      const current = layout.rows[i]!;
      expect(current.rect.y).toBe(previous.rect.y + previous.rect.height);
    }
  });

  it("splits each row into a label area and a tiles area that tile the row exactly", () => {
    const layout = layoutBoard(withItems(0), { width: 800 });
    const row = layout.rows[0]!;

    expect(row.labelRect.x).toBe(row.rect.x);
    expect(row.labelRect.width).toBe(120);
    expect(row.tilesRect.x).toBe(row.rect.x + row.labelRect.width);
    expect(row.labelRect.width + row.tilesRect.width).toBe(row.rect.width);
    expect(row.labelRect.height).toBe(row.rect.height);
  });

  it("puts every unplaced item in the tray, in placement index order", () => {
    const layout = layoutBoard(withItems(3), { width: 800 });
    expect(layout.tray.tiles.map((t) => t.itemId)).toEqual(["i0", "i1", "i2"]);
    expect(layout.rows.every((r) => r.tiles.length === 0)).toBe(true);
  });

  it("lays tiles left to right in placement index order", () => {
    let doc = withItems(3);
    doc = reduce(doc, { type: "placement/place", itemId: "i0", rowId: S, index: 0 }, NOW);
    doc = reduce(doc, { type: "placement/place", itemId: "i1", rowId: S, index: 1 }, NOW);

    const layout = layoutBoard(doc, { width: 800 });
    const tiles = layout.rows[0]!.tiles;

    expect(tiles.map((t) => t.itemId)).toEqual(["i0", "i1"]);
    expect(tiles[1]!.rect.x).toBeGreaterThan(tiles[0]!.rect.x);
    expect(tiles[1]!.rect.y).toBe(tiles[0]!.rect.y);
  });

  it("wraps tiles onto a new line and grows the row to fit them", () => {
    // 96px tiles with a 6px gap in a 200px tiles area: floor((200-6)/102) = 1 column.
    let doc = withItems(3);
    doc = reduce(doc, { type: "placement/place", itemId: "i0", rowId: S, index: 0 }, NOW);
    doc = reduce(doc, { type: "placement/place", itemId: "i1", rowId: S, index: 1 }, NOW);
    doc = reduce(doc, { type: "placement/place", itemId: "i2", rowId: S, index: 2 }, NOW);

    const layout = layoutBoard(doc, { width: 320 });
    const tiles = layout.rows[0]!.tiles;

    expect(tiles[0]!.rect.x).toBe(tiles[1]!.rect.x);
    expect(tiles[1]!.rect.y).toBeGreaterThan(tiles[0]!.rect.y);
    expect(layout.rows[0]!.rect.height).toBeGreaterThan(layout.rows[1]!.rect.height);
  });

  it("keeps an empty row tall enough to be a drop target", () => {
    const layout = layoutBoard(withItems(0), { width: 800 });
    expect(layout.rows[0]!.rect.height).toBeGreaterThanOrEqual(96);
  });

  it("honours a per-row tile size override without disturbing other rows", () => {
    let doc = withItems(2);
    doc = reduce(doc, { type: "placement/place", itemId: "i0", rowId: S, index: 0 }, NOW);
    doc = reduce(doc, { type: "placement/place", itemId: "i1", rowId: A, index: 0 }, NOW);
    doc = {
      ...doc,
      rows: doc.rows.map((r) => (r.id === S ? { ...r, tileSizeOverride: 48 } : r)),
    };

    const layout = layoutBoard(doc, { width: 800 });
    expect(layout.rows[0]!.tiles[0]!.rect.width).toBe(48);
    expect(layout.rows[1]!.tiles[0]!.rect.width).toBe(96);
  });

  it("makes tiles taller than they are wide for a portrait aspect", () => {
    let doc = withItems(1);
    doc = reduce(doc, { type: "placement/place", itemId: "i0", rowId: S, index: 0 }, NOW);
    doc = reduce(doc, { type: "display/set", patch: { tileAspect: "portrait" } }, NOW);

    const rect = layoutBoard(doc, { width: 800 }).rows[0]!.tiles[0]!.rect;
    expect(rect.height).toBeGreaterThan(rect.width);
  });

  it("reports a content height that reaches the bottom of the tray", () => {
    const layout = layoutBoard(withItems(2), { width: 800 });
    expect(layout.contentHeight).toBe(layout.tray.rect.y + layout.tray.rect.height);
  });

  it("puts the tray below every row", () => {
    const layout = layoutBoard(withItems(2), { width: 800 });
    const lastRow = layout.rows[layout.rows.length - 1]!;
    expect(layout.tray.rect.y).toBe(lastRow.rect.y + lastRow.rect.height);
  });

  it("never produces a zero-column layout, however narrow the board", () => {
    let doc = withItems(1);
    doc = reduce(doc, { type: "placement/place", itemId: "i0", rowId: S, index: 0 }, NOW);

    const layout = layoutBoard(doc, { width: 10 });
    expect(layout.rows[0]!.tiles).toHaveLength(1);
    expect(Number.isFinite(layout.rows[0]!.tiles[0]!.rect.x)).toBe(true);
  });

  it("drops the label rather than the tiles area when the board is too narrow for both", () => {
    const layout = layoutBoard(withItems(0), { width: 10 });
    const row = layout.rows[0]!;

    expect(row.labelRect.width).toBe(0);
    expect(row.tilesRect.width).toBe(10);
    expect(row.tilesRect.x).toBe(row.rect.x);
  });

  it("insets the board by the padding on every side, bottom included", () => {
    const layout = layoutBoard(withItems(2), { width: 800, padding: 20 });
    const firstRow = layout.rows[0]!;

    expect(firstRow.rect.x).toBe(20);
    expect(firstRow.rect.y).toBe(20);
    expect(firstRow.rect.width).toBe(760);
    // Reaching only the bottom of the tray would leave the board inset at the
    // top and flush at the bottom once it is scrolled.
    expect(layout.contentHeight).toBe(
      layout.tray.rect.y + layout.tray.rect.height + 20,
    );
  });

  it("surrounds the tiles with the same gap on every inner edge of a row", () => {
    let doc = withItems(2);
    doc = reduce(doc, { type: "placement/place", itemId: "i0", rowId: S, index: 0 }, NOW);
    doc = reduce(doc, { type: "placement/place", itemId: "i1", rowId: S, index: 1 }, NOW);

    const row = layoutBoard(doc, { width: 800 }).rows[0]!;
    const first = row.tiles[0]!;
    const second = row.tiles[1]!;

    // A row one gap too tall or too short is invisible in a stacking check,
    // because every row would be wrong by the same amount.
    expect(first.rect.y - row.tilesRect.y).toBe(6);
    const rowBottom = row.rect.y + row.rect.height;
    expect(rowBottom - (first.rect.y + first.rect.height)).toBe(6);
    expect(first.rect.x - row.tilesRect.x).toBe(6);
    expect(second.rect.x - (first.rect.x + first.rect.width)).toBe(6);
  });

  it("keeps that gap below the last line when tiles wrap", () => {
    let doc = withItems(3);
    for (let i = 0; i < 3; i += 1) {
      doc = reduce(doc, { type: "placement/place", itemId: `i${i}`, rowId: S, index: i }, NOW);
    }

    const row = layoutBoard(doc, { width: 320 }).rows[0]!;
    const last = row.tiles[row.tiles.length - 1]!;

    expect(row.tiles).toHaveLength(3);
    expect(row.rect.y + row.rect.height - (last.rect.y + last.rect.height)).toBe(6);
  });

  it("tightens the layout as density decreases", () => {
    let doc = withItems(1);
    doc = reduce(doc, { type: "placement/place", itemId: "i0", rowId: S, index: 0 }, NOW);

    const heightAt = (density: Density): number =>
      layoutBoard(reduce(doc, { type: "display/set", patch: { density } }, NOW), {
        width: 800,
      }).rows[0]!.rect.height;

    expect(heightAt("compact")).toBeLessThan(heightAt("normal"));
    expect(heightAt("normal")).toBeLessThan(heightAt("roomy"));
  });

  it("orders tiles by placement index even when the array disagrees", () => {
    // `migrateV1ToV2` renumbers placements without reordering the array, so a
    // migrated document can arrive with the two out of step. Index wins.
    const base = withItems(3);
    const doc: TierList = { ...base, placements: [...base.placements].reverse() };

    expect(doc.placements.map((p) => p.itemId)).toEqual(["i2", "i1", "i0"]);
    expect(layoutBoard(doc, { width: 800 }).tray.tiles.map((t) => t.itemId)).toEqual(
      ["i0", "i1", "i2"],
    );
  });

  it("does not mutate the document it is handed", () => {
    let doc = withItems(2);
    doc = reduce(doc, { type: "placement/place", itemId: "i1", rowId: S, index: 0 }, NOW);
    const placements = doc.placements.map((p) => ({ ...p }));
    const rows = doc.rows.map((r) => ({ ...r }));

    layoutBoard(doc, { width: 320 });

    expect(doc.placements).toEqual(placements);
    expect(doc.rows).toEqual(rows);
  });
});
