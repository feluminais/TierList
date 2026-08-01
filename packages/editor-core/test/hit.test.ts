import { createTierList, reduce, type TierList } from "@tl/core";
import { describe, expect, it } from "vitest";
import { dropTargetAt, hitTest, insertionIndex, type Hit } from "../src/hit";
import { layoutBoard, type BoardLayout } from "../src/layout";

const NOW = "2026-08-01T12:00:00.000Z";
const S = "list-1-row-0";

function withItems(count: number): TierList {
  let doc = createTierList({ id: "list-1", now: NOW });
  for (let i = 0; i < count; i += 1) {
    doc = reduce(doc, { type: "item/addText", id: `i${i}`, label: `i${i}` }, NOW);
  }
  return doc;
}

/** Three items in row S, the rest of the items left in the tray. */
function populated(): TierList {
  let doc = withItems(4);
  doc = reduce(doc, { type: "placement/place", itemId: "i0", rowId: S, index: 0 }, NOW);
  doc = reduce(doc, { type: "placement/place", itemId: "i1", rowId: S, index: 1 }, NOW);
  doc = reduce(doc, { type: "placement/place", itemId: "i2", rowId: S, index: 2 }, NOW);
  return doc;
}

/** `count` items in row S and nothing in the tray, for wrapping cases. */
function filled(count: number): TierList {
  let doc = withItems(count);
  for (let i = 0; i < count; i += 1) {
    doc = reduce(doc, { type: "placement/place", itemId: `i${i}`, rowId: S, index: i }, NOW);
  }
  return doc;
}

function centre(rect: { x: number; y: number; width: number; height: number }) {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

describe("hitTest", () => {
  it("finds a tile and reports which location it sits in", () => {
    const layout = layoutBoard(populated(), { width: 800 });
    const tile = layout.rows[0]!.tiles[1]!;
    expect(hitTest(layout, centre(tile.rect))).toEqual({
      kind: "tile",
      itemId: "i1",
      rowId: S,
    });
  });

  it("reports a tray tile with a null rowId", () => {
    const layout = layoutBoard(populated(), { width: 800 });
    const tile = layout.tray.tiles[0]!;
    expect(hitTest(layout, centre(tile.rect))).toEqual({
      kind: "tile",
      itemId: "i3",
      rowId: null,
    });
  });

  it("finds a row label", () => {
    const layout = layoutBoard(populated(), { width: 800 });
    expect(hitTest(layout, centre(layout.rows[0]!.labelRect))).toEqual({
      kind: "rowLabel",
      rowId: S,
    });
  });

  it("finds empty space inside a row", () => {
    const layout = layoutBoard(populated(), { width: 800 });
    const row = layout.rows[0]!;
    const emptySpot = { x: row.tilesRect.x + row.tilesRect.width - 10, y: centre(row.rect).y };
    expect(hitTest(layout, emptySpot)).toEqual({ kind: "rowArea", rowId: S });
  });

  it("finds empty space in the tray", () => {
    const layout = layoutBoard(populated(), { width: 800 });
    const spot = { x: layout.tray.rect.x + layout.tray.rect.width - 10, y: centre(layout.tray.rect).y };
    expect(hitTest(layout, spot)).toEqual({ kind: "trayArea" });
  });

  it("returns none for a point outside the board", () => {
    const layout = layoutBoard(populated(), { width: 800 });
    expect(hitTest(layout, { x: 400, y: layout.contentHeight + 50 })).toEqual({ kind: "none" });
    expect(hitTest(layout, { x: 400, y: -10 })).toEqual({ kind: "none" });
  });

  it("gives a boundary point to exactly one row", () => {
    const layout = layoutBoard(populated(), { width: 800 });
    const boundary = layout.rows[0]!.rect.y + layout.rows[0]!.rect.height;
    const hit = hitTest(layout, { x: layout.rows[1]!.labelRect.x + 5, y: boundary });
    expect(hit).toEqual({ kind: "rowLabel", rowId: "list-1-row-1" });
  });

  // The row/row boundary above is only half the seam. The last row and the
  // tray abut in exactly the same way, and nothing else in this file would
  // notice if the tray started one pixel late.
  it("gives the seam between the last row and the tray to the tray", () => {
    const layout = layoutBoard(populated(), { width: 800 });
    const last = layout.rows[layout.rows.length - 1]!;
    const boundary = last.rect.y + last.rect.height;

    expect(boundary).toBe(layout.tray.rect.y);
    expect(hitTest(layout, { x: 700, y: boundary })).toEqual({ kind: "trayArea" });
    expect(hitTest(layout, { x: 700, y: boundary - 1 })).toEqual({
      kind: "rowArea",
      rowId: "list-1-row-4",
    });
  });

  it("returns none inside the padding margin", () => {
    const layout = layoutBoard(populated(), { width: 800, padding: 20 });
    expect(hitTest(layout, { x: 10, y: 10 })).toEqual({ kind: "none" });
    // The bottom padding is part of the content but belongs to no location.
    expect(hitTest(layout, { x: 400, y: layout.contentHeight - 5 })).toEqual({ kind: "none" });
  });
});

describe("insertionIndex", () => {
  it("returns 0 for a point left of the first tile", () => {
    const tiles = layoutBoard(populated(), { width: 800 }).rows[0]!.tiles;
    expect(insertionIndex(tiles, { x: tiles[0]!.rect.x + 1, y: centre(tiles[0]!.rect).y }, null)).toBe(0);
  });

  it("returns the count for a point past the last tile", () => {
    const tiles = layoutBoard(populated(), { width: 800 }).rows[0]!.tiles;
    const past = { x: tiles[2]!.rect.x + tiles[2]!.rect.width + 50, y: centre(tiles[2]!.rect).y };
    expect(insertionIndex(tiles, past, null)).toBe(3);
  });

  it("inserts before a tile when the point is left of its centre", () => {
    const tiles = layoutBoard(populated(), { width: 800 }).rows[0]!.tiles;
    const leftOfSecond = { x: tiles[1]!.rect.x + 1, y: centre(tiles[1]!.rect).y };
    expect(insertionIndex(tiles, leftOfSecond, null)).toBe(1);
  });

  it("inserts after a tile when the point is right of its centre", () => {
    const tiles = layoutBoard(populated(), { width: 800 }).rows[0]!.tiles;
    const rightOfSecond = {
      x: tiles[1]!.rect.x + tiles[1]!.rect.width - 1,
      y: centre(tiles[1]!.rect).y,
    };
    expect(insertionIndex(tiles, rightOfSecond, null)).toBe(2);
  });

  it("ignores the tile being dragged, so dropping it back yields its own index", () => {
    const tiles = layoutBoard(populated(), { width: 800 }).rows[0]!.tiles;
    expect(insertionIndex(tiles, centre(tiles[1]!.rect), "i1")).toBe(1);
  });

  it("counts every tile on an earlier line as before the point", () => {
    // 1 column at 320px wide, so the three tiles stack vertically.
    const tiles = layoutBoard(populated(), { width: 320 }).rows[0]!.tiles;
    expect(insertionIndex(tiles, centre(tiles[2]!.rect), null)).toBe(3);
    expect(insertionIndex(tiles, { x: tiles[1]!.rect.x + 1, y: tiles[1]!.rect.y + 1 }, null)).toBe(1);
  });

  it("returns 0 for a location with no tiles", () => {
    const layout = layoutBoard(populated(), { width: 800 });
    const empty = layout.rows[1]!;
    expect(empty.tiles).toHaveLength(0);
    expect(insertionIndex(empty.tiles, centre(empty.rect), null)).toBe(0);
  });

  // The single case above pins index 1 only. The drag machine reads a no-op
  // drop off this identity holding for *every* slot, wrapped rows included, so
  // one sample is not enough to trust it.
  it("returns a tile's own index for every tile in a wrapped row", () => {
    // 8 tiles at 6 columns: a full first line and a partial second one.
    const tiles = layoutBoard(filled(8), { width: 800 }).rows[0]!.tiles;
    expect(tiles).toHaveLength(8);
    expect(tiles[6]!.rect.y).toBeGreaterThan(tiles[5]!.rect.y);

    tiles.forEach((tile, index) => {
      expect(insertionIndex(tiles, centre(tile.rect), tile.itemId)).toBe(index);
    });
  });

  it("puts the slack right of a full line at the start of the next line", () => {
    const row = layoutBoard(filled(8), { width: 800 }).rows[0]!;
    const lastOnFirstLine = row.tiles[5]!;
    const slack = {
      x: row.tilesRect.x + row.tilesRect.width - 1,
      y: centre(lastOnFirstLine.rect).y,
    };

    // The point really is past the last tile of the line and still on it.
    expect(slack.x).toBeGreaterThan(lastOnFirstLine.rect.x + lastOnFirstLine.rect.width);
    expect(insertionIndex(row.tiles, slack, null)).toBe(6);
  });

  // `contains` is half-open so that two stacked rows cannot both claim a
  // boundary pixel. The same convention has to hold line to line, or a point
  // resting exactly on a tile's bottom edge would be scored by x against the
  // line above it and land at the front of that line instead of after it.
  it("treats a tile's bottom edge as already past it", () => {
    const tiles = layoutBoard(filled(8), { width: 800 }).rows[0]!.tiles;
    const onBottomEdge = {
      // Left of every centre on the first line, so only the y test can carry it.
      x: tiles[0]!.rect.x + 1,
      y: tiles[0]!.rect.y + tiles[0]!.rect.height,
    };

    expect(onBottomEdge.y).toBeLessThan(tiles[6]!.rect.y);
    expect(insertionIndex(tiles, onBottomEdge, null)).toBe(6);
  });

  it("treats a tile's halfway mark as already past it", () => {
    const tiles = layoutBoard(populated(), { width: 800 }).rows[0]!.tiles;
    const half = {
      x: tiles[0]!.rect.x + tiles[0]!.rect.width / 2,
      y: centre(tiles[0]!.rect).y,
    };
    expect(insertionIndex(tiles, half, null)).toBe(1);
  });

  it("returns 0 for a point in the gap above the first line", () => {
    // Far to the right, so anything that failed to notice the point is above
    // every tile would score it by x and return the full count.
    const row = layoutBoard(filled(8), { width: 800 }).rows[0]!;
    const above = { x: row.tilesRect.x + row.tilesRect.width - 1, y: row.rect.y };

    expect(above.y).toBeLessThan(row.tiles[0]!.rect.y);
    expect(insertionIndex(row.tiles, above, null)).toBe(0);
  });

  it("puts the gap between two lines at the start of the lower one", () => {
    const tiles = layoutBoard(filled(8), { width: 800 }).rows[0]!.tiles;
    const betweenLines = {
      x: tiles[0]!.rect.x + 1,
      y: tiles[0]!.rect.y + tiles[0]!.rect.height + 1,
    };

    expect(betweenLines.y).toBeLessThan(tiles[6]!.rect.y);
    expect(insertionIndex(tiles, betweenLines, null)).toBe(6);
  });
});

describe("dropTargetAt", () => {
  it("targets a row and the position within it", () => {
    const layout = layoutBoard(populated(), { width: 800 });
    const tile = layout.rows[0]!.tiles[1]!;
    expect(dropTargetAt(layout, { x: tile.rect.x + 1, y: centre(tile.rect).y }, "i3")).toEqual({
      rowId: S,
      index: 1,
    });
  });

  it("targets the end of a row when the point is past its last tile", () => {
    const layout = layoutBoard(populated(), { width: 800 });
    const row = layout.rows[0]!;
    const empty = { x: row.tilesRect.x + row.tilesRect.width - 5, y: centre(row.rect).y };
    expect(dropTargetAt(layout, empty, "i3")).toEqual({ rowId: S, index: 3 });
  });

  it("targets an empty row at index 0", () => {
    const layout = layoutBoard(populated(), { width: 800 });
    const row = layout.rows[1]!;
    expect(dropTargetAt(layout, centre(row.rect), "i3")).toEqual({
      rowId: "list-1-row-1",
      index: 0,
    });
  });

  it("targets the tray with a null rowId", () => {
    const layout = layoutBoard(populated(), { width: 800 });
    const target = dropTargetAt(layout, centre(layout.tray.rect), "i0");
    expect(target?.rowId).toBeNull();
  });

  it("targets the front of a populated row when the point is over its label", () => {
    // Deliberately row S, which has three tiles: every one of them sits to the
    // right of the label, so none counts as before the point and the item
    // lands at the front. Aiming at the tier letter means "put it in this tier".
    const layout = layoutBoard(populated(), { width: 800 });
    expect(dropTargetAt(layout, centre(layout.rows[0]!.labelRect), "i3")).toEqual({
      rowId: S,
      index: 0,
    });
  });

  // That "lands at the front" reasoning only holds while the row is a single
  // line. Once it wraps, tiles on earlier lines do sit before the point, and
  // the index tracks how far down the label the pointer is.
  it("follows the pointer down the label of a wrapped row", () => {
    const layout = layoutBoard(populated(), { width: 320 });
    const label = layout.rows[0]!.labelRect;

    expect(layout.rows[0]!.tiles[1]!.rect.y).toBeGreaterThan(layout.rows[0]!.tiles[0]!.rect.y);
    expect(dropTargetAt(layout, { x: label.x + 5, y: label.y + 5 }, "i3")).toEqual({
      rowId: S,
      index: 0,
    });
    expect(dropTargetAt(layout, centre(label), "i3")).toEqual({ rowId: S, index: 1 });
  });

  it("returns null outside the board", () => {
    const layout = layoutBoard(populated(), { width: 800 });
    expect(dropTargetAt(layout, { x: 400, y: layout.contentHeight + 50 }, "i0")).toBeNull();
  });

  it("returns a tray item's own index when it is dropped back where it started", () => {
    const layout = layoutBoard(withItems(4), { width: 800 });
    expect(layout.tray.tiles.map((t) => t.itemId)).toEqual(["i0", "i1", "i2", "i3"]);

    layout.tray.tiles.forEach((tile, index) => {
      expect(dropTargetAt(layout, centre(tile.rect), tile.itemId)).toEqual({
        rowId: null,
        index,
      });
    });
  });

  // hitTest resolves labels before row areas while dropTargetAt only looks at
  // the row rect. If those two orders ever came apart, a press would highlight
  // one row and the drop would land in another.
  it("never disagrees with hitTest about which location a point is in", () => {
    const layout = layoutBoard(populated(), { width: 800, padding: 20 });

    /** The location a hit implies: a row id, null for the tray, undefined for nowhere. */
    const locationOf = (hit: Hit): string | null | undefined => {
      switch (hit.kind) {
        case "tile":
          return hit.rowId;
        case "rowLabel":
        case "rowArea":
          return hit.rowId;
        case "trayArea":
          return null;
        case "none":
          return undefined;
      }
    };

    const seen = new Set<string>();
    for (let x = 0; x < 800; x += 7) {
      for (let y = -5; y < layout.contentHeight + 5; y += 5) {
        const point = { x, y };
        const hit = hitTest(layout, point);
        const target = dropTargetAt(layout, point, "i3");
        seen.add(hit.kind);

        const location = locationOf(hit);
        if (location === undefined) expect(target).toBeNull();
        else expect(target?.rowId).toBe(location);
      }
    }

    // A sweep that only ever produced "none" would pass vacuously.
    expect([...seen].sort()).toEqual(["none", "rowArea", "rowLabel", "tile", "trayArea"]);
  });
});

describe("layout invariants hit testing relies on", () => {
  // hitTest checks every row tile before any label, and every tray tile before
  // the tray area. That ordering is only safe because the rects it skips past
  // cannot overlap the ones it checks first.
  it("keeps tiles inside their own location and labels clear of tiles", () => {
    const check = (layout: BoardLayout) => {
      for (const row of layout.rows) {
        expect(row.labelRect.x + row.labelRect.width).toBeLessThanOrEqual(row.tilesRect.x);
        for (const tile of row.tiles) {
          expect(tile.rect.x).toBeGreaterThanOrEqual(row.tilesRect.x);
          expect(tile.rect.x + tile.rect.width).toBeLessThanOrEqual(
            row.tilesRect.x + row.tilesRect.width,
          );
          expect(tile.rect.y).toBeGreaterThanOrEqual(row.rect.y);
          expect(tile.rect.y + tile.rect.height).toBeLessThanOrEqual(row.rect.y + row.rect.height);
        }
      }
      for (const tile of layout.tray.tiles) {
        expect(tile.rect.y).toBeGreaterThanOrEqual(layout.tray.rect.y);
        expect(tile.rect.y + tile.rect.height).toBeLessThanOrEqual(
          layout.tray.rect.y + layout.tray.rect.height,
        );
      }
    };

    check(layoutBoard(filled(8), { width: 800 }));
    check(layoutBoard(filled(8), { width: 320, padding: 20 }));
  });
});
