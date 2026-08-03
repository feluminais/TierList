import type { TierListAction } from "@tl/core";
import type { Point, Rect } from "./geometry";
import { strokeFromPoints, toSourcePoint } from "./strokes";

/**
 * Everything the machine needs about the surface being drawn on, supplied
 * fresh on every event — the same contract `editReduce` and `cropReduce` hold,
 * and for the same reason: the board reflows as tiers resize, and a machine
 * holding its own copy would commit points measured against a stale one.
 */
export interface BoardPenContext {
  /** The board's rect in the space pointers are reported in. */
  board: Rect;
  /** Simplification tolerance, in board-normalized units. */
  tolerance: number;
}

export type BoardPenState =
  | { phase: "idle" }
  | {
      phase: "drawing";
      strokeId: string;
      color: string;
      width: number;
      /** Flat [x0, y0, x1, y1, …], normalized 0..1 against the board. */
      points: number[];
    };

export type BoardPenEvent =
  | {
      type: "penDown";
      at: Point;
      context: BoardPenContext;
      strokeId: string;
      color: string;
      /** A fraction of the board's width, as `Stroke.width` is defined. */
      width: number;
    }
  | { type: "penMove"; at: Point; context: BoardPenContext }
  | { type: "penUp"; at: Point; context: BoardPenContext }
  | { type: "cancel" };

export interface BoardPenResult {
  state: BoardPenState;
  /** Non-null exactly when the gesture committed a mark. */
  action: TierListAction | null;
}

export function idleBoardPen(): BoardPenState {
  return { phase: "idle" };
}

/**
 * The board is the whole surface, so a point normalizes against it directly.
 *
 * Reuses `toSourcePoint` with a full-frame crop rather than dividing here: it
 * is the same arithmetic a tile's strokes go through, and two spellings of one
 * mapping are two things to keep in step.
 */
const WHOLE_SURFACE = { x: 0, y: 0, w: 1, h: 1 };

function normalize(at: Point, context: BoardPenContext): Point {
  return toSourcePoint(at, context.board, WHOLE_SURFACE);
}

/**
 * A mark needs at least two *distinct* points to be a line. One point is a
 * tap, and committing it would put an invisible mark in the document and an
 * undo step that appears to do nothing.
 */
function isDrawable(points: number[]): boolean {
  if (points.length < 4) return false;
  for (let i = 2; i < points.length; i += 2) {
    if (points[i] !== points[0] || points[i + 1] !== points[1]) return true;
  }
  return false;
}

/**
 * The pen for annotating a finished list.
 *
 * The same machine shape as the tile pen, emitting `board/addStroke` instead
 * of `item/setEdit`: one gesture, one action, at `penUp` and never before, so
 * a mark is one undo step, one revision and one save.
 *
 * Deliberately a separate machine rather than `editReduce` with a different
 * action. A tile's stroke is stored against its *source image* and follows the
 * crop, so it stays on the face it was drawn on when the framing moves; a
 * board annotation is stored against the *board* and belongs to the list as a
 * whole. They only look alike because both are freehand.
 *
 * Pure, and it never reads a clock — a pen gesture has no timing component.
 */
export function boardPenReduce(
  state: BoardPenState,
  event: BoardPenEvent,
): BoardPenResult {
  switch (event.type) {
    case "cancel":
      return { state: idleBoardPen(), action: null };

    case "penDown": {
      const start = normalize(event.at, event.context);
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
      // A move with no mark under way is not an error: a gesture can begin
      // outside the board and wander in.
      if (state.phase !== "drawing") return { state, action: null };
      const point = normalize(event.at, event.context);
      return {
        state: { ...state, points: [...state.points, point.x, point.y] },
        action: null,
      };
    }

    case "penUp": {
      if (state.phase !== "drawing") return { state, action: null };
      const point = normalize(event.at, event.context);
      const points = [...state.points, point.x, point.y];

      if (!isDrawable(points)) return { state: idleBoardPen(), action: null };

      return {
        state: idleBoardPen(),
        action: {
          type: "board/addStroke",
          stroke: strokeFromPoints(
            state.strokeId,
            points,
            state.color,
            state.width,
            event.context.tolerance,
          ),
        },
      };
    }
  }
}

/**
 * A board annotation's points, back in board coordinates for drawing.
 *
 * The inverse of what `boardPenReduce` stores. Unclamped, for the same reason
 * `toTilePoint` is: a mark made when the board was taller legitimately falls
 * outside a shorter one, and clamping would smear it along the edge instead of
 * letting the renderer place it honestly.
 */
export function boardStrokePoints(points: number[], board: Rect): number[] {
  const out: number[] = [];
  for (let p = 0; p + 1 < points.length; p += 2) {
    out.push(board.x + points[p]! * board.width, board.y + points[p + 1]! * board.height);
  }
  return out;
}

/** A stroke's width in board pixels. It is stored as a fraction of the width. */
export function boardStrokeWidth(width: number, board: Rect): number {
  return width * board.width;
}
