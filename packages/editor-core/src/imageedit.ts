import type { ImageEdit, TierListAction } from "@tl/core";
import type { Point, Rect } from "./geometry";
import { strokeFromPoints, toSourcePoint } from "./strokes";

/**
 * Everything the machine needs about the tile being edited, supplied fresh on
 * every event.
 *
 * Passed in rather than held in the state deliberately: the document can
 * change underneath a gesture — an autosave completing, an undo elsewhere —
 * and a machine holding its own copy of the edit would commit a stale one over
 * the top. The same reasoning that keeps `dragReduce` reading a `BoardLayout`
 * from its caller on every event rather than capturing one at `down`.
 */
export interface EditContext {
  itemId: string;
  /** The tile's rect in the coordinate space the pointer is reported in. */
  tile: Rect;
  /** The item's current edit — the base this gesture will build on. */
  edit: ImageEdit;
  /** Simplification tolerance, in source-normalized units. */
  tolerance: number;
}

export type EditState =
  | { phase: "idle" }
  | {
      phase: "drawing";
      strokeId: string;
      color: string;
      width: number;
      /** Flat [x0, y0, x1, y1, …] in source-normalized coordinates. */
      points: number[];
    };

export type EditEvent =
  | {
      type: "penDown";
      at: Point;
      context: EditContext;
      strokeId: string;
      color: string;
      width: number;
    }
  | { type: "penMove"; at: Point; context: EditContext }
  | { type: "penUp"; at: Point; context: EditContext }
  | { type: "cancel" };

export interface EditResult {
  state: EditState;
  /** Non-null exactly when the gesture committed something. */
  action: TierListAction | null;
}

export function idleEdit(): EditState {
  return { phase: "idle" };
}

/**
 * A stroke needs at least two *distinct* points to be a line. One point is a
 * tap, and committing it would put an invisible mark in the document and an
 * undo step on the stack that appears to do nothing.
 */
function isDrawable(points: number[]): boolean {
  if (points.length < 4) return false;
  for (let i = 2; i < points.length; i += 2) {
    if (points[i] !== points[0] || points[i + 1] !== points[1]) return true;
  }
  return false;
}

/**
 * The edit sheet's gesture machine.
 *
 * One gesture emits at most one action, at the end — which is what makes a
 * scribble exactly one undo step, one revision and one autosave.
 * `mergeKeyFor` leaves `item/setEdit` unkeyed for precisely this reason: it
 * cannot know which part of an `ImageEdit` moved, so coalescing has to happen
 * here, where the gesture boundary is known, rather than in the history.
 *
 * Pure, and it never reads a clock — a pen gesture has no timing component, so
 * unlike `dragReduce` it does not even need time passed in.
 */
export function editReduce(state: EditState, event: EditEvent): EditResult {
  switch (event.type) {
    case "cancel":
      return { state: idleEdit(), action: null };

    case "penDown": {
      // A second finger touching down mid-stroke (no intervening `penUp`) is
      // not rejected: this machine tracks one logical stroke, and the caller
      // is responsible for which pointer it feeds in. Starting a fresh stroke
      // silently abandons whatever was captured for the first — there is no
      // event to commit it against — which is pinned behaviour, not an
      // accident, so a two-finger touch loses the earlier points rather than
      // corrupting a merged stroke or throwing.
      const start = toSourcePoint(event.at, event.context.tile, event.context.edit.crop);
      return {
        state: {
          phase: "drawing",
          strokeId: event.strokeId,
          color: event.color,
          width: event.width,
          points: [start.x, start.y],
        },
        action: null,
      };
    }

    case "penMove": {
      // A move with no stroke under way is not an error: a gesture can begin
      // outside the sheet and wander in.
      if (state.phase !== "drawing") return { state, action: null };
      const point = toSourcePoint(event.at, event.context.tile, event.context.edit.crop);
      return {
        state: { ...state, points: [...state.points, point.x, point.y] },
        action: null,
      };
    }

    case "penUp": {
      if (state.phase !== "drawing") return { state, action: null };
      const point = toSourcePoint(event.at, event.context.tile, event.context.edit.crop);
      const points = [...state.points, point.x, point.y];

      if (!isDrawable(points)) return { state: idleEdit(), action: null };

      const stroke = strokeFromPoints(
        state.strokeId,
        points,
        state.color,
        state.width,
        event.context.tolerance,
      );

      // Built from the context's edit rather than from anything captured at
      // penDown, so a document that moved during the gesture is not clobbered.
      const edit: ImageEdit = {
        ...event.context.edit,
        strokes: [...event.context.edit.strokes, stroke],
      };

      return {
        state: idleEdit(),
        action: { type: "item/setEdit", itemId: event.context.itemId, edit },
      };
    }
  }
}
