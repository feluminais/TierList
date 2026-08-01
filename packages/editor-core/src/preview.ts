import type { DragState } from "./drag";
import type { Rect } from "./geometry";
import { findTile, type DropTarget } from "./hit";
import type { BoardLayout, TileBox } from "./layout";

/** Width of the bar drawn where a dropped item would land. */
export const CARET_WIDTH = 4;

/**
 * Where to draw the tile that is following the finger, or null when nothing
 * is being dragged.
 *
 * The document does not change during a drag, so the dragged item is still in
 * the layout at its old position — the preview is drawn on top of an unchanged
 * board. Size comes from that tile, so the thing under the finger is the size
 * it will be when it lands.
 */
export function dragPreviewRect(
  layout: BoardLayout,
  state: DragState,
): Rect | null {
  if (state.phase !== "dragging") return null;

  const found = findTile(layout, state.itemId);
  if (!found) return null;

  return {
    x: state.pointer.x - state.grab.x,
    y: state.pointer.y - state.grab.y,
    width: found.rect.width,
    height: found.rect.height,
  };
}

interface Location {
  tiles: TileBox[];
  area: Rect;
}

function locationOf(layout: BoardLayout, rowId: string | null): Location | null {
  if (rowId === null) {
    return { tiles: layout.tray.tiles, area: layout.tray.tilesRect };
  }
  const row = layout.rows.find((r) => r.rowId === rowId);
  return row ? { tiles: row.tiles, area: row.tilesRect } : null;
}

/**
 * Where to draw the insertion bar for a drop target, or null when there is no
 * target or the target names a row the layout does not have.
 *
 * Anchored to the tile at that index rather than computed from a gap, so on a
 * wrapped row the caret follows the tile onto its own line instead of sitting
 * at the end of the previous one.
 */
export function insertionCaretRect(
  layout: BoardLayout,
  target: DropTarget | null,
): Rect | null {
  if (!target) return null;

  const location = locationOf(layout, target.rowId);
  if (!location) return null;

  const at = location.tiles[target.index];
  if (at) {
    return {
      x: at.rect.x - CARET_WIDTH,
      y: at.rect.y,
      width: CARET_WIDTH,
      height: at.rect.height,
    };
  }

  const last = location.tiles[location.tiles.length - 1];
  if (last) {
    return {
      x: last.rect.x + last.rect.width,
      y: last.rect.y,
      width: CARET_WIDTH,
      height: last.rect.height,
    };
  }

  // An empty location has no tile to anchor to, so the caret spans the area
  // it would fill, inset a little so it does not sit flush against the edge.
  return {
    x: location.area.x + CARET_WIDTH,
    y: location.area.y + CARET_WIDTH,
    width: CARET_WIDTH,
    height: Math.max(CARET_WIDTH, location.area.height - CARET_WIDTH * 2),
  };
}
