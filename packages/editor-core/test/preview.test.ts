import { createTierList, reduce, type TierList } from "@tl/core";
import { describe, expect, it } from "vitest";
import { dragReduce, idleDrag, DRAG_HOLD_MS, type DragState } from "../src/drag";
import { layoutBoard, type BoardLayout } from "../src/layout";
import { dragPreviewRect, insertionCaretRect } from "../src/preview";

const NOW = "2026-08-01T12:00:00.000Z";
const S = "list-1-row-0";
const A = "list-1-row-1";

function populated(): TierList {
  let doc = createTierList({ id: "list-1", now: NOW });
  for (let i = 0; i < 4; i += 1) {
    doc = reduce(doc, { type: "item/addText", id: `i${i}`, label: `i${i}` }, NOW);
  }
  doc = reduce(doc, { type: "placement/place", itemId: "i0", rowId: S, index: 0 }, NOW);
  doc = reduce(doc, { type: "placement/place", itemId: "i1", rowId: S, index: 1 }, NOW);
  doc = reduce(doc, { type: "placement/place", itemId: "i2", rowId: S, index: 2 }, NOW);
  return doc;
}

const LAYOUT: BoardLayout = layoutBoard(populated(), { width: 800 });

function centre(r: { x: number; y: number; width: number; height: number }) {
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

/** Press and hold tile i1 until the machine is dragging. */
function dragging(layout: BoardLayout = LAYOUT): DragState {
  const at = { point: centre(layout.rows[0]!.tiles[1]!.rect), time: 0 };
  const down = dragReduce(idleDrag(), { type: "down", at, layout });
  return dragReduce(down.state, {
    type: "hold",
    at: { point: at.point, time: DRAG_HOLD_MS },
    layout,
  }).state;
}

describe("dragPreviewRect", () => {
  it("is null unless a drag is under way", () => {
    expect(dragPreviewRect(LAYOUT, idleDrag())).toBeNull();
  });

  it("matches the dragged tile's size", () => {
    // Deliberately not the square default: with width === height a preview
    // that transposed the two would pass, and this is the assertion that is
    // supposed to catch exactly that.
    const portrait = layoutBoard(
      reduce(populated(), { type: "display/set", patch: { tileAspect: "portrait" } }, NOW),
      { width: 800 },
    );
    const tile = portrait.rows[0]!.tiles[1]!.rect;
    expect(tile.width).not.toBe(tile.height);

    const rect = dragPreviewRect(portrait, dragging(portrait))!;
    expect(rect.width).toBe(tile.width);
    expect(rect.height).toBe(tile.height);
  });

  it("is null when the dragged item has left the layout", () => {
    // The document is frozen for the duration of a drag, but the *layout* is
    // not: every drag event carries a fresh one, so a sync that deletes the
    // item under the finger arrives as a layout without its tile. There is no
    // size to draw at that point, and a zero rect at the origin would paint a
    // speck in the corner.
    const gone = layoutBoard(createTierList({ id: "list-1", now: NOW }), { width: 800 });
    expect(dragPreviewRect(gone, dragging())).toBeNull();
  });

  it("sits exactly under the tile it was lifted from before the finger moves", () => {
    const rect = dragPreviewRect(LAYOUT, dragging())!;
    const tile = LAYOUT.rows[0]!.tiles[1]!.rect;
    expect(rect.x).toBeCloseTo(tile.x, 5);
    expect(rect.y).toBeCloseTo(tile.y, 5);
  });

  it("follows the pointer, keeping the grab offset", () => {
    const start = dragging();
    const moved = dragReduce(start, {
      type: "move",
      at: { point: { x: 500, y: 300 }, time: DRAG_HOLD_MS + 50 },
      layout: LAYOUT,
    }).state;

    const before = dragPreviewRect(LAYOUT, start)!;
    const after = dragPreviewRect(LAYOUT, moved)!;
    const startPoint = centre(LAYOUT.rows[0]!.tiles[1]!.rect);

    expect(after.x - before.x).toBeCloseTo(500 - startPoint.x, 5);
    expect(after.y - before.y).toBeCloseTo(300 - startPoint.y, 5);
  });
});

describe("insertionCaretRect", () => {
  it("is null when there is no target", () => {
    expect(insertionCaretRect(LAYOUT, null)).toBeNull();
  });

  it("sits left of the tile currently at that index", () => {
    const caret = insertionCaretRect(LAYOUT, { rowId: S, index: 1 })!;
    const tile = LAYOUT.rows[0]!.tiles[1]!.rect;
    expect(caret.x).toBeLessThan(tile.x);
    expect(caret.x).toBeGreaterThan(LAYOUT.rows[0]!.tiles[0]!.rect.x);
    expect(caret.y).toBe(tile.y);
    expect(caret.height).toBe(tile.height);
  });

  it("sits right of the last tile when the index is past the end", () => {
    const caret = insertionCaretRect(LAYOUT, { rowId: S, index: 3 })!;
    const last = LAYOUT.rows[0]!.tiles[2]!.rect;
    expect(caret.x).toBeGreaterThanOrEqual(last.x + last.width);

    // On a wrapped row "past the end" means after the last tile on the *last*
    // line, not off the end of the row's first line. A caret taking its y from
    // the row instead of the tile is indistinguishable on a single-line row,
    // which is why it is checked here rather than above.
    const narrow = layoutBoard(populated(), { width: 320 });
    const tiles = narrow.rows[0]!.tiles;
    const wrapped = insertionCaretRect(narrow, { rowId: S, index: 3 })!;
    expect(wrapped.y).toBe(tiles[2]!.rect.y);
    expect(wrapped.y).toBeGreaterThan(tiles[0]!.rect.y);
  });

  it("sits at the start of an empty row", () => {
    const caret = insertionCaretRect(LAYOUT, { rowId: A, index: 0 })!;
    const row = LAYOUT.rows[1]!;
    expect(row.tiles).toHaveLength(0);
    expect(caret.x).toBeGreaterThan(row.tilesRect.x);
    expect(caret.x).toBeLessThan(row.tilesRect.x + 40);
    expect(caret.height).toBeGreaterThan(0);

    // An empty location is laid out as exactly one line, so "the whole area
    // height" is one tile plus its gaps -- not the runaway bar it would be on
    // a location that had grown. Pinned here because the empty branch is the
    // only one that measures the area instead of a tile.
    const tile = LAYOUT.rows[0]!.tiles[0]!.rect;
    expect(caret.height).toBeGreaterThanOrEqual(tile.height);
    expect(caret.height).toBeLessThan(tile.height * 1.5);

    // And it stays inside the row it is marking: this branch is the only one
    // that derives a height by arithmetic rather than copying a tile's, so it
    // is the only one that can overflow.
    expect(caret.y).toBeGreaterThanOrEqual(row.tilesRect.y);
    expect(caret.y + caret.height).toBeLessThanOrEqual(
      row.tilesRect.y + row.tilesRect.height,
    );
  });

  it("targets the tray with a null rowId", () => {
    const caret = insertionCaretRect(LAYOUT, { rowId: null, index: 0 })!;
    expect(caret.y).toBeGreaterThanOrEqual(LAYOUT.tray.rect.y);
  });

  it("follows a wrapped tile onto its own line", () => {
    // 1 column at 320px wide, so the row's three tiles stack vertically.
    const narrow = layoutBoard(populated(), { width: 320 });
    const tiles = narrow.rows[0]!.tiles;

    // Without this the assertion below is vacuous: if the row had not
    // wrapped, every tile would share a y and anchoring to tile 2 would prove
    // nothing about following it onto a new line.
    expect(new Set(tiles.map((t) => t.rect.y)).size).toBe(3);

    const caret = insertionCaretRect(narrow, { rowId: S, index: 2 })!;
    expect(caret.y).toBe(tiles[2]!.rect.y);
    expect(caret.y).toBeGreaterThan(tiles[1]!.rect.y);
  });

  it("stays inside its location when the gap is narrower than the caret", () => {
    // Compact density's gap is 2px, and the caret is 4px wide, so there is not
    // enough room between the end of a full line and the edge of the location
    // to draw one. 710px is chosen so the row's tiles area (710 - 120 label)
    // is exactly gap + 6 * (tile + gap): the line fills to within one gap of
    // the right edge, which at padding 0 is the board edge.
    let doc = reduce(
      populated(),
      { type: "display/set", patch: { density: "compact" } },
      NOW,
    );
    for (let i = 4; i < 8; i += 1) {
      doc = reduce(doc, { type: "item/addText", id: `i${i}`, label: `i${i}` }, NOW);
    }
    doc = reduce(doc, { type: "placement/place", itemId: "i3", rowId: S, index: 3 }, NOW);
    doc = reduce(doc, { type: "placement/place", itemId: "i4", rowId: S, index: 4 }, NOW);
    doc = reduce(doc, { type: "placement/place", itemId: "i5", rowId: S, index: 5 }, NOW);

    const tight = layoutBoard(doc, { width: 710 });
    const row = tight.rows[0]!;
    const last = row.tiles[5]!.rect;

    // Vacuous unless the line really is full to within less than a caret of
    // the edge -- on a row with room to spare there is nothing to clamp.
    expect(row.tiles).toHaveLength(6);
    expect(new Set(row.tiles.map((t) => t.rect.y)).size).toBe(1);
    const slack = row.tilesRect.x + row.tilesRect.width - (last.x + last.width);
    expect(slack).toBeLessThan(4);

    const past = insertionCaretRect(tight, { rowId: S, index: 6 })!;
    expect(past.x + past.width).toBeLessThanOrEqual(
      row.tilesRect.x + row.tilesRect.width,
    );

    // The same shortfall at the other end: the first tile sits one 2px gap in
    // from the left, so a caret drawn to its left starts outside the tray.
    const tray = insertionCaretRect(tight, { rowId: null, index: 0 })!;
    expect(tight.tray.tiles.length).toBeGreaterThan(0);
    expect(tray.x).toBeGreaterThanOrEqual(tight.tray.tilesRect.x);
  });

  it("returns null for a row that is not in the layout", () => {
    expect(insertionCaretRect(LAYOUT, { rowId: "nope", index: 0 })).toBeNull();
  });
});
