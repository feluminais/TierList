import { contains, type Point, type Rect } from "./geometry";
import type { BoardLayout, TileBox } from "./layout";

export type Hit =
  | { kind: "tile"; itemId: string; rowId: string | null }
  | { kind: "rowLabel"; rowId: string }
  | { kind: "rowArea"; rowId: string }
  | { kind: "trayArea" }
  | { kind: "none" };

/** Where a dragged item would land. `rowId: null` means the tray. */
export interface DropTarget {
  rowId: string | null;
  index: number;
}

/**
 * What is under `point`. Tiles win over the areas beneath them, because a
 * tile is drawn on top of its row and a press on one means the tile.
 *
 * Checking every tile before any area is only safe because `layoutBoard` keeps
 * a tile inside its own location and clear of the label column, so no tile
 * this loop reaches can belong to an area a later loop would have claimed.
 */
export function hitTest(layout: BoardLayout, point: Point): Hit {
  for (const row of layout.rows) {
    for (const tile of row.tiles) {
      if (contains(tile.rect, point)) {
        return { kind: "tile", itemId: tile.itemId, rowId: row.rowId };
      }
    }
  }

  for (const tile of layout.tray.tiles) {
    if (contains(tile.rect, point)) {
      return { kind: "tile", itemId: tile.itemId, rowId: null };
    }
  }

  for (const row of layout.rows) {
    if (contains(row.labelRect, point)) {
      return { kind: "rowLabel", rowId: row.rowId };
    }
    if (contains(row.rect, point)) {
      return { kind: "rowArea", rowId: row.rowId };
    }
  }

  if (contains(layout.tray.rect, point)) return { kind: "trayArea" };

  return { kind: "none" };
}

/**
 * True when `point` falls after `rect` in reading order: on a later line, or
 * on the same line and past the halfway mark. Comparing against the halfway
 * mark rather than an edge is what makes the insertion point follow the
 * pointer smoothly instead of jumping a slot late.
 */
function isAfter(point: Point, rect: Rect): boolean {
  if (point.y >= rect.y + rect.height) return true;
  if (point.y < rect.y) return false;
  return point.x >= rect.x + rect.width / 2;
}

/**
 * Where `point` sits in a sequence of tiles laid out in reading order.
 *
 * `exclude` is the item being dragged, or null when nothing is. Leaving it in
 * would mean an item dropped exactly where it started came back with a
 * different index — the drag machine relies on that comparison to recognise a
 * no-op drop.
 */
export function insertionIndex(
  tiles: TileBox[],
  point: Point,
  exclude: string | null,
): number {
  let index = 0;
  for (const tile of tiles) {
    if (tile.itemId === exclude) continue;
    if (isAfter(point, tile.rect)) index += 1;
  }
  return index;
}

/**
 * The drop target under `point`, or null when it is off the board.
 *
 * A row's label counts as part of the row: aiming at the tier letter is a
 * natural way to say "put it in this tier", and rejecting it would feel
 * broken. The index still comes from the pointer, so on a single-line row the
 * item lands at the front — every tile is to the right of the label — while on
 * a wrapped row it lands level with wherever down the label you aimed.
 *
 * The row a point belongs to is decided by `row.rect` alone, exactly as in
 * `hitTest`: `labelRect` is a sub-rect of `rect`, so resolving labels first
 * there cannot pick a different row than this loop does.
 */
export function dropTargetAt(
  layout: BoardLayout,
  point: Point,
  draggingItemId: string,
): DropTarget | null {
  for (const row of layout.rows) {
    if (!contains(row.rect, point)) continue;
    return {
      rowId: row.rowId,
      index: insertionIndex(row.tiles, point, draggingItemId),
    };
  }

  if (contains(layout.tray.rect, point)) {
    return {
      rowId: null,
      index: insertionIndex(layout.tray.tiles, point, draggingItemId),
    };
  }

  return null;
}
