import type { TierListAction } from "@tl/core";
import { DRAG_HOLD_MS, DRAG_SLOP_PX, type PointerSample } from "./drag";
import type { Point, Rect } from "./geometry";
import type { BoardLayout } from "./layout";

/**
 * Thickness of the bar marking where a dragged tier would land, in px.
 * Matches the tile caret's weight so the two read as the same idea.
 */
const CARET_THICKNESS = 3;

export type RowDragState =
  | { phase: "idle" }
  | {
      phase: "pending";
      rowId: string;
      origin: PointerSample;
      pointer: Point;
      /** Whether movement alone may promote this press — see `DragEvent`. */
      immediate: boolean;
    }
  | {
      phase: "dragging";
      rowId: string;
      /** Where the tier sat when the drag began, so a drop that changes
       *  nothing can be recognised and emit nothing. */
      fromIndex: number;
      /** Pointer offset within the tier's label cell at grab time, so the
       *  floating copy does not jump under the pointer when it appears. */
      grab: Point;
      pointer: Point;
      toIndex: number;
    };

export type RowDragEvent =
  | {
      type: "down";
      /**
       * Which tier was pressed.
       *
       * Passed in rather than hit-tested, unlike `dragReduce`. The handle is a
       * DOM element positioned over the tier's label cell, so the caller
       * genuinely knows which tier the press landed on; hit-testing the point
       * again would be a second answer to a question already settled, free to
       * disagree with the first when the two are given different layouts.
       */
      rowId: string;
      at: PointerSample;
      layout: BoardLayout;
      immediate?: boolean;
    }
  | { type: "move"; at: PointerSample; layout: BoardLayout }
  | { type: "hold"; at: PointerSample; layout: BoardLayout }
  | { type: "up"; at: PointerSample; layout: BoardLayout }
  | { type: "cancel" };

export interface RowDragResult {
  state: RowDragState;
  /** Non-null exactly when the gesture committed a reorder. */
  action: TierListAction | null;
  /** Set when the gesture turned out to be a tap rather than a drag. */
  tapped: { rowId: string } | null;
}

export function idleRowDrag(): RowDragState {
  return { phase: "idle" };
}

function result(
  state: RowDragState,
  overrides: Partial<Omit<RowDragResult, "state">> = {},
): RowDragResult {
  return {
    state,
    action: overrides.action ?? null,
    tapped: overrides.tapped ?? null,
  };
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Where a tier dragged to `y` would land, as an index among the *other* tiers.
 *
 * Counts the tiers whose vertical midpoint the pointer has passed, skipping the
 * one being dragged. Excluding it is what makes a drop in place come back as
 * the index it started at rather than one along — the same reason
 * `insertionIndex` takes an `exclude`.
 *
 * The midpoint rather than an edge is what makes the caret follow the pointer
 * smoothly instead of jumping a slot late, and tiers have wildly different
 * heights once they carry size overrides, so a fixed step would not do.
 *
 * The result indexes `doc.rows` **after the dragged row is spliced out**, which
 * is exactly what `row/reorder` clamps and inserts at.
 */
export function rowDropIndexAt(
  layout: BoardLayout,
  y: number,
  draggingRowId: string,
): number {
  let index = 0;
  for (const row of layout.rows) {
    if (row.rowId === draggingRowId) continue;
    if (y >= row.rect.y + row.rect.height / 2) index += 1;
  }
  return index;
}

/**
 * The bar showing where a dragged tier would land, or null when the board has
 * no tiers to land between.
 *
 * `index` counts the tiers other than the one being dragged, so the bar is
 * drawn at the top edge of whichever remaining tier would be pushed down — and
 * at the bottom of the last one when the tier is headed for the end.
 */
export function rowCaretRect(
  layout: BoardLayout,
  index: number,
  draggingRowId: string,
): Rect | null {
  const others = layout.rows.filter((row) => row.rowId !== draggingRowId);
  if (others.length === 0) return null;

  const clamped = Math.min(Math.max(index, 0), others.length);
  const before = others[clamped];
  const edge = before
    ? before.rect.y
    : others[others.length - 1]!.rect.y + others[others.length - 1]!.rect.height;

  const first = others[0]!;
  return {
    x: first.rect.x,
    y: edge - CARET_THICKNESS / 2,
    width: first.rect.width,
    height: CARET_THICKNESS,
  };
}

/** The tier's index in visual order, or -1 when it is not in the layout. */
function indexOf(layout: BoardLayout, rowId: string): number {
  return layout.rows.findIndex((row) => row.rowId === rowId);
}

function promote(
  state: Extract<RowDragState, { phase: "pending" }>,
  at: PointerSample,
  layout: BoardLayout,
): RowDragResult {
  const index = indexOf(layout, state.rowId);
  // The tier went away under the pointer — removed, or an undo reaching back
  // past when it was added. There is nothing to pick up, and dragging a
  // phantom would end in a reorder for a tier the document no longer holds.
  if (index === -1) return result(idleRowDrag());

  const label = layout.rows[index]!.labelRect;

  return result({
    phase: "dragging",
    rowId: state.rowId,
    fromIndex: index,
    // Measured from the sample that starts the drag rather than from the
    // press, so the floating copy appears under the pointer where it is now
    // instead of jumping by however far it wandered during the hold.
    grab: { x: at.point.x - label.x, y: at.point.y - label.y },
    pointer: at.point,
    toIndex: rowDropIndexAt(layout, at.point.y, state.rowId),
  });
}

/**
 * The tier reordering gesture.
 *
 * The same contract as `dragReduce`, deliberately: one gesture emits at most
 * one action, at the drop, so the document is never touched while the pointer
 * is down and a reorder is exactly one undo step, one revision and one save.
 * Every event carries the layout it happened against, so a board that reflows
 * mid-gesture is targeted against what is on screen now.
 *
 * Pure, and it never reads a clock — time arrives on every sample.
 *
 * Constrained to reordering by construction: the only action it can emit is
 * `row/reorder`, and the only thing it tracks is a vertical position among
 * tiers. A tier cannot be dropped into the tray or onto another tier.
 */
export function rowDragReduce(
  state: RowDragState,
  event: RowDragEvent,
): RowDragResult {
  if (event.type === "cancel") return result(idleRowDrag());

  switch (state.phase) {
    case "idle": {
      if (event.type !== "down") return result(state);
      if (indexOf(event.layout, event.rowId) === -1) return result(state);

      return result({
        phase: "pending",
        rowId: event.rowId,
        origin: event.at,
        pointer: event.at.point,
        immediate: event.immediate ?? false,
      });
    }

    case "pending": {
      if (event.type === "up") {
        return result(idleRowDrag(), { tapped: { rowId: state.rowId } });
      }
      if (event.type !== "move" && event.type !== "hold") return result(state);

      // Slop before the clock, and measured against the press rather than the
      // previous sample — the same ordering `dragReduce` documents. A
      // coalesced flick can deliver its first move late and far, and judging
      // time first would promote it.
      if (distance(event.at.point, state.origin.point) > DRAG_SLOP_PX) {
        if (state.immediate) return promote(state, event.at, event.layout);
        return result(idleRowDrag());
      }

      if (event.at.time - state.origin.time >= DRAG_HOLD_MS) {
        return promote(state, event.at, event.layout);
      }

      return result({ ...state, pointer: event.at.point });
    }

    case "dragging": {
      if (event.type === "move" || event.type === "hold") {
        return result({
          ...state,
          pointer: event.at.point,
          toIndex: rowDropIndexAt(event.layout, event.at.point.y, state.rowId),
        });
      }

      if (event.type !== "up") return result(state);

      // Read from the release sample rather than the tracked target: the
      // pointer can lift somewhere no move ever reported.
      const toIndex = rowDropIndexAt(event.layout, event.at.point.y, state.rowId);

      // Dropped where it started. `fromIndex` counts every tier including this
      // one, and `toIndex` counts only the others, so the two describe the same
      // slot when the tier has not passed any of its neighbours — which for a
      // tier at position `f` means landing at `f`.
      if (toIndex === state.fromIndex) return result(idleRowDrag());

      return result(idleRowDrag(), {
        action: { type: "row/reorder", rowId: state.rowId, toIndex },
      });
    }
  }
}
