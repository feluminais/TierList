"use client";

import { DEFAULT_STROKE_WIDTH, type TierList, type TierListAction } from "@tl/core";
import {
  boardPenReduce,
  boardStrokePoints,
  boardStrokeWidth,
  idleBoardPen,
  type BoardLayout,
  type BoardPenContext,
  type BoardPenEvent,
  type BoardPenState,
} from "@tl/editor-core";
import {
  useCallback,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { ColorPopover } from "./ColorPopover";
import { newId } from "@tl/app-core";

/** Pen weights offered, as fractions of the board's width. */
const WIDTHS = [
  { label: "Fine", value: DEFAULT_STROKE_WIDTH / 2 },
  { label: "Medium", value: DEFAULT_STROKE_WIDTH },
  { label: "Bold", value: DEFAULT_STROKE_WIDTH * 2 },
];

/**
 * Points are capped here rather than in `boardPenReduce`, whose contract is to
 * record every point it is given. Thinning cost grows sharply with the count,
 * and a fast gesture on a high-refresh screen produces far more samples than a
 * mark needs.
 */
const MAX_SAMPLES = 1200;

export interface AnnotateLayerProps {
  doc: TierList;
  layout: BoardLayout;
  width: number;
  onAction: (action: TierListAction) => void;
  onDone: () => void;
  /**
   * The board, given the mark still under the pen.
   *
   * A render prop because the pen's state lives here and the canvas that draws
   * it lives on the other side of the dynamic-import boundary — the host can
   * only receive it as a prop, and lifting the state up would put a
   * pointer-rate `setState` in the component that owns the whole document.
   */
  children: (live: LiveAnnotation | null) => ReactNode;
}

export interface LiveAnnotation {
  points: number[];
  color: string;
  width: number;
}

/**
 * Drawing across the whole list, rather than inside one tile.
 *
 * A separate surface from the tile pen because it is a different thing: a
 * tile's stroke is stored against its source image and follows the crop, so it
 * stays on the face it was drawn on; a board annotation belongs to the list as
 * a whole and is stored against the board. They only look alike.
 *
 * Mounted *instead of* the drag and tier overlays, not beside them. While the
 * pen is out, a press means a mark — there is no way to also mean "pick this
 * tile up", and offering both would make every gesture a guess.
 */
export function AnnotateLayer({
  doc,
  layout,
  width,
  onAction,
  onDone,
  children,
}: AnnotateLayerProps) {
  const [color, setColor] = useState("#4ade80");
  const [strokeWidth, setStrokeWidth] = useState(DEFAULT_STROKE_WIDTH);
  const [pickerAt, setPickerAt] = useState<{ x: number; y: number } | null>(null);

  const [pen, setPen] = useState<BoardPenState>(idleBoardPen);
  // Written synchronously inside `send`, before `setState`: pointer moves
  // outrun React's render and batch, so a handler reading the state variable
  // would reduce against what last rendered and drop everything between.
  const penRef = useRef(pen);

  const board = { x: 0, y: 0, width, height: layout.contentHeight };
  const context: BoardPenContext = { board, tolerance: 0.0008 };
  const contextRef = useRef(context);
  contextRef.current = context;

  const send = useCallback(
    (event: BoardPenEvent) => {
      const out = boardPenReduce(penRef.current, event);
      penRef.current = out.state;
      setPen(out.state);
      if (out.action) onAction(out.action);
    },
    [onAction],
  );

  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const pointFrom = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = surfaceRef.current!.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Capture is an improvement, not a requirement — see TierOverlay.
    }
    send({
      type: "penDown",
      at: pointFrom(event),
      context: contextRef.current,
      strokeId: newId(),
      color,
      width: strokeWidth,
    });
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = penRef.current;
    if (current.phase !== "drawing") return;
    if (current.points.length / 2 >= MAX_SAMPLES) return;
    send({ type: "penMove", at: pointFrom(event), context: contextRef.current });
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    send({ type: "penUp", at: pointFrom(event), context: contextRef.current });
  };

  const marks = doc.boardAnnotations.length;

  return (
    <div style={{ width: "100%" }}>
      <div style={bar}>
        <strong style={{ fontSize: 13 }}>Annotating</strong>

        <button
          type="button"
          aria-label="Pen colour"
          data-testid="annotate-color"
          onClick={(event) => setPickerAt({ x: event.clientX, y: event.clientY })}
          style={{ ...swatch, background: color }}
        />

        {WIDTHS.map((w) => (
          <button
            key={w.label}
            type="button"
            data-testid={`annotate-width-${w.label.toLowerCase()}`}
            aria-pressed={strokeWidth === w.value}
            onClick={() => setStrokeWidth(w.value)}
            style={button(strokeWidth === w.value)}
          >
            {w.label}
          </button>
        ))}

        <button
          type="button"
          data-testid="annotate-undo-last"
          // Removing the last mark rather than a general undo: the toolbar's
          // Undo already walks the whole history, and a second control that
          // did the same thing would be two names for one action.
          disabled={marks === 0}
          onClick={() => {
            const last = doc.boardAnnotations[marks - 1];
            if (last) onAction({ type: "board/removeStroke", strokeId: last.id });
          }}
          style={button(false, marks === 0)}
        >
          Remove last
        </button>
        <button
          type="button"
          data-testid="annotate-clear"
          disabled={marks === 0}
          onClick={() => onAction({ type: "board/clearStrokes" })}
          style={button(false, marks === 0)}
        >
          Clear all
        </button>

        <span data-testid="annotate-count" style={{ color: "#8b98a6", fontSize: 12 }}>
          {marks} {marks === 1 ? "mark" : "marks"}
        </span>

        <button
          type="button"
          data-testid="annotate-done"
          onClick={onDone}
          style={{ ...button(true), marginLeft: "auto" }}
        >
          Done
        </button>
      </div>

      <div
        ref={surfaceRef}
        data-testid="annotate-surface"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => send({ type: "cancel" })}
        style={{ width, touchAction: "none", cursor: "crosshair" }}
      >
        {children(liveAnnotationOf(pen, board))}
      </div>

      {pickerAt ? (
        <ColorPopover
          value={color}
          origin={pickerAt}
          onPick={setColor}
          onClose={() => setPickerAt(null)}
        />
      ) : null}
    </div>
  );
}

/** The mark under the pen, in board coordinates, for the canvas to draw. */
function liveAnnotationOf(
  pen: BoardPenState,
  board: { x: number; y: number; width: number; height: number },
): LiveAnnotation | null {
  if (pen.phase !== "drawing") return null;
  return {
    points: boardStrokePoints(pen.points, board),
    color: pen.color,
    width: boardStrokeWidth(pen.width, board),
  };
}

const bar: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: 8,
  padding: 10,
  marginBottom: 12,
  background: "#12161b",
  border: "1px solid #3b8beb",
  borderRadius: 8,
  color: "#e6edf3",
  fontFamily: "system-ui, sans-serif",
};

const swatch: CSSProperties = {
  width: 30,
  height: 24,
  borderRadius: 6,
  border: "1px solid #3a4450",
  cursor: "pointer",
  padding: 0,
};

function button(active: boolean, disabled = false): CSSProperties {
  return {
    background: disabled ? "#171c22" : active ? "#2b3542" : "#222b35",
    border: `1px solid ${active ? "#3b8beb" : "#2c3540"}`,
    borderRadius: 6,
    color: disabled ? "#5b6673" : "#e6edf3",
    padding: "6px 12px",
    cursor: disabled ? "default" : "pointer",
    fontFamily: "inherit",
    fontSize: 13,
  };
}
