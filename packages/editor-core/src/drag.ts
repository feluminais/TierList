import type { TierListAction } from "@tl/core";
import type { Point, Rect } from "./geometry";
import { dropTargetAt, hitTest, type DropTarget } from "./hit";
import type { BoardLayout } from "./layout";

/**
 * How long a press must be held before it becomes a drag.
 *
 * A drag cannot start on movement: on a touch screen, movement already means
 * scroll, and stealing it would make a board taller than the viewport
 * impossible to navigate. Holding is the gesture that has no other meaning.
 */
export const DRAG_HOLD_MS = 250;

/** How far a finger may wander during the hold and still be holding still. */
export const DRAG_SLOP_PX = 8;

export interface PointerSample {
  point: Point;
  /** Milliseconds from any fixed origin. Supplied by the caller so this
   *  module never reads a clock, exactly as @tl/core's reducer never does. */
  time: number;
}

export type DragState =
  | { phase: "idle" }
  | {
      phase: "pending";
      itemId: string;
      origin: PointerSample;
      pointer: Point;
    }
  | {
      phase: "dragging";
      itemId: string;
      /** Where the item sat when the drag began, so a drop that changes
       *  nothing can be recognised and emit nothing. */
      from: DropTarget;
      /** Pointer offset within the tile at grab time, so the tile does not
       *  jump under the finger when the drag preview appears. */
      grab: Point;
      pointer: Point;
      target: DropTarget | null;
    };

export type DragEvent =
  | { type: "down"; at: PointerSample; layout: BoardLayout }
  | { type: "move"; at: PointerSample; layout: BoardLayout }
  | { type: "hold"; at: PointerSample; layout: BoardLayout }
  | { type: "up"; at: PointerSample; layout: BoardLayout }
  | { type: "cancel" };

export interface DragResult {
  state: DragState;
  /** Non-null exactly when the gesture committed a move. */
  action: TierListAction | null;
  /** True when the caller should hand the gesture back to the scroller. */
  releaseToScroll: boolean;
  /** Set when the gesture turned out to be a tap rather than a drag. */
  tapped: { itemId: string } | null;
}

export function idleDrag(): DragState {
  return { phase: "idle" };
}

function result(
  state: DragState,
  overrides: Partial<Omit<DragResult, "state">> = {},
): DragResult {
  return {
    state,
    action: overrides.action ?? null,
    releaseToScroll: overrides.releaseToScroll ?? false,
    tapped: overrides.tapped ?? null,
  };
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

interface ItemLocation {
  /** Comparable with a `dropTargetAt` result: `layoutBoard` emits tiles in
   *  placement index order, and placement indices are contiguous within a
   *  location, so a tile's position in this array *is* its placement index —
   *  which is also what `insertionIndex` returns for a point over that tile
   *  once the dragged item is excluded. */
  at: DropTarget;
  rect: Rect;
}

/** Where an item currently sits, so a drop back onto it can be recognised. */
function locate(layout: BoardLayout, itemId: string): ItemLocation | null {
  for (const row of layout.rows) {
    const index = row.tiles.findIndex((t) => t.itemId === itemId);
    const tile = row.tiles[index];
    if (tile) return { at: { rowId: row.rowId, index }, rect: tile.rect };
  }

  const trayIndex = layout.tray.tiles.findIndex((t) => t.itemId === itemId);
  const trayTile = layout.tray.tiles[trayIndex];
  if (trayTile) return { at: { rowId: null, index: trayIndex }, rect: trayTile.rect };

  return null;
}

/**
 * Turn a held press into a drag.
 *
 * The item is located in the layout the drag is *starting* in, not the one the
 * finger landed in. A sync from another device can move or delete it during
 * the hold, and both halves of the drag read this: `from` is what a no-op drop
 * is compared against, and the tile rect is what stops the preview jumping.
 */
function promote(
  state: Extract<DragState, { phase: "pending" }>,
  at: PointerSample,
  layout: BoardLayout,
): DragResult {
  const found = locate(layout, state.itemId);

  // The item went away under the finger. There is nothing to pick up, and
  // dragging a phantom would end in a `placement/place` for an item the
  // document no longer has — which the reducer does not refuse. Hand the
  // gesture to the scroller instead: the finger is still down and this
  // machine is not taking it.
  if (!found) return result(idleDrag(), { releaseToScroll: true });

  return result({
    phase: "dragging",
    itemId: state.itemId,
    from: found.at,
    // Measured from the sample that starts the drag, not from the press:
    // the preview appears now, under the finger as it is now. Measuring from
    // the press would jump the tile by however far the finger wandered
    // during the hold.
    grab: { x: at.point.x - found.rect.x, y: at.point.y - found.rect.y },
    pointer: at.point,
    target: dropTargetAt(layout, at.point, state.itemId),
  });
}

/**
 * Pure gesture state machine. One drag produces at most one action, emitted on
 * drop — the document is never touched while the finger is down. That is what
 * makes a drag exactly one undo step, one autosave and one revision.
 *
 * Every event carries the layout it happened against rather than the machine
 * holding one, so a board that reflows mid-gesture is targeted against what is
 * on screen now.
 */
export function dragReduce(state: DragState, event: DragEvent): DragResult {
  if (event.type === "cancel") return result(idleDrag());

  switch (state.phase) {
    case "idle": {
      // A move, an up, or a hold timer left over from a gesture already given
      // to the scroller: nothing here is the start of anything.
      if (event.type !== "down") return result(state);

      const hit = hitTest(event.layout, event.at.point);
      if (hit.kind !== "tile") return result(state);

      return result({
        phase: "pending",
        itemId: hit.itemId,
        origin: event.at,
        pointer: event.at.point,
      });
    }

    case "pending": {
      if (event.type === "up") {
        return result(idleDrag(), { tapped: { itemId: state.itemId } });
      }
      // A second finger while a press is pending. This machine tracks one
      // pointer; the caller decides which one, and the rest are not ours.
      if (event.type !== "move" && event.type !== "hold") return result(state);

      // Slop is judged before the clock, and against the press rather than
      // the previous sample. A finger that has travelled this far is
      // scrolling, and elapsed time is no evidence to the contrary: it says
      // only that this event is late, not that the finger was ever still.
      // A janky frame on a mid-range Android can swallow every move of a
      // flick and deliver the first one after the hold window has passed.
      if (distance(event.at.point, state.origin.point) > DRAG_SLOP_PX) {
        return result(idleDrag(), { releaseToScroll: true });
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
          target: dropTargetAt(event.layout, event.at.point, state.itemId),
        });
      }

      // A second finger, again: ignored. Note that no move releases to the
      // scroller once the drag is under way — the gesture is ours until it
      // ends. Reaching the edge of a board taller than the viewport is
      // handled by the platform scrolling *around* the drag, not by giving
      // the gesture back, which would drop the item somewhere unasked.
      if (event.type !== "up") return result(state);

      // Read from the release sample, not from the tracked target: the finger
      // can lift somewhere no move ever reported.
      const target = dropTargetAt(event.layout, event.at.point, state.itemId);

      // Dropped nowhere, or back where it started. Emitting an action here
      // would bump the revision, queue a save and add an undo step for a
      // gesture that changed nothing.
      if (
        !target ||
        (target.rowId === state.from.rowId && target.index === state.from.index)
      ) {
        return result(idleDrag());
      }

      return result(idleDrag(), {
        action: {
          type: "placement/place",
          itemId: state.itemId,
          rowId: target.rowId,
          index: target.index,
        },
      });
    }
  }
}
