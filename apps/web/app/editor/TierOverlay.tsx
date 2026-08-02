"use client";

import type { TierList, TierListAction } from "@tl/core";
import {
  DRAG_HOLD_MS,
  clampTileSize,
  idleRowDrag,
  layoutBoard,
  rowCaretRect,
  rowDragReduce,
  type Rect,
  type RowDragEvent,
  type RowDragState,
} from "@tl/editor-core";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { PANEL_WIDTH, TierPanel } from "./TierPanel";

/** Distance from the label cell's edges for the buttons pinned inside it. */
const INSET = 4;
/** The edit button's size, in px. Matches a tile's at a comparable scale. */
const EDIT_SIZE = 22;
/** The corner grip's size, in px. */
const GRIP_SIZE = 16;

/**
 * How a corner drag turns into a tile size.
 *
 * The mean of the two axes rather than either alone: the grip sits on a corner,
 * so a diagonal pull is the natural motion and moving both ways at once should
 * count once, not twice. A purely vertical or horizontal drag still works, at
 * half rate, which reads as deliberate rather than broken.
 */
function sizeDelta(dx: number, dy: number): number {
  return (dx + dy) / 2;
}

/**
 * Take pointer capture, tolerating a refusal.
 *
 * `setPointerCapture` throws `NotFoundError` when the id names no active
 * pointer, and an exception thrown out of a `pointerdown` handler abandons the
 * rest of it — so a gesture that merely *wanted* capture would never record
 * that it had begun, and the whole interaction would silently do nothing.
 * Capture is an improvement here, not a requirement: it keeps a drag alive when
 * the pointer leaves the element, and without it the drag still works while the
 * pointer stays put.
 */
function capturePointer(element: Element, pointerId: number): void {
  try {
    element.setPointerCapture(pointerId);
  } catch {
    // Not capturable; the gesture proceeds uncaptured.
  }
}

/** Release capture if this element holds it. Mirrors `capturePointer`. */
function releasePointer(element: Element, pointerId: number): void {
  try {
    if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
  } catch {
    // Nothing held it; nothing to release.
  }
}

/** The size a tier renders at: its own override, or the list-wide size. */
function effectiveSizeOf(doc: TierList, rowId: string): number {
  const row = doc.rows.find((r) => r.id === rowId);
  return row?.tileSizeOverride ?? doc.display.tileSize;
}

export interface TierOverlayProps {
  doc: TierList;
  /** Must be the width the canvas was drawn at, or the overlay drifts from it. */
  width: number;
  /** True while a *tile* drag is in flight; tier affordances stand down. */
  dragging: boolean;
  /**
   * Whether a press may become a drag on movement alone, without the hold.
   * Set for a precise pointer, exactly as `InteractiveBoard`'s `immediateDrag`
   * is, and for the same reason: a mouse has no page scroll to steal.
   */
  immediate: boolean;
  onAction: (action: TierListAction) => void;
  /** The label and colour alone; the id is minted at the call site. */
  onAddRow: (label: string, color: string) => void;
  children?: ReactNode;
}

/**
 * Everything a tier can be done to, laid over the board.
 *
 * A DOM layer rather than canvas drawing, for the same reason the tile edit
 * button is one: these are buttons, a colour input and a slider, none of which
 * Skia renders or takes input for. Positions come from `layoutBoard` — the
 * exact call the canvas is drawn from — so a handle cannot sit anywhere but on
 * the tier it belongs to.
 *
 * The layer is `pointerEvents: none` and only the handles set it back to
 * `auto`, so everything not explicitly interactive falls through to the canvas
 * and the tile drag beneath.
 */
export function TierOverlay({
  doc,
  width,
  dragging,
  immediate,
  onAction,
  onAddRow,
  children,
}: TierOverlayProps) {
  const layout = useMemo(() => layoutBoard(doc, { width }), [doc, width]);

  const [hovered, setHovered] = useState<string | null>(null);
  /**
   * Which tier's panel is open, and which way it opened.
   *
   * The direction is decided once, when the panel opens, and kept — rather
   * than recomputed each render — because it is a question about the page, not
   * about the board: `labelRect.x` is a *board* coordinate and is 0 for every
   * tier at every window size, so comparing it against a width in css pixels
   * answers the wrong question and always gives the same answer. What decides
   * it is where the board sits in the viewport, which only a measurement knows.
   */
  const [open, setOpen] = useState<{ rowId: string; openRight: boolean } | null>(null);
  const openRowId = open?.rowId ?? null;
  /**
   * Whether the size controls drive every tier at once.
   *
   * Local rather than derived from the document. "Every row lacks an override"
   * would derive to the same thing on the frame the box is ticked, and then
   * un-ticking it would derive straight back to ticked because nothing had
   * changed yet — a checkbox that refuses to turn off.
   */
  const [resizeAll, setResizeAll] = useState(false);

  const [rowDrag, setRowDrag] = useState<RowDragState>(idleRowDrag);
  // Written synchronously inside `send`, before `setState`, for the reason
  // `EditSheet` documents: pointer moves outrun React's renders and batch, so
  // a handler reading the state variable would reduce against what last
  // rendered and lose everything in between.
  const rowDragRef = useRef(rowDrag);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  const send = useCallback(
    (event: RowDragEvent) => {
      const out = rowDragReduce(rowDragRef.current, event);
      rowDragRef.current = out.state;
      setRowDrag(out.state);
      if (out.action) onAction(out.action);
      return out;
    },
    [onAction],
  );

  // The hold that promotes a touch press. Owned here because `rowDragReduce`
  // never reads a clock — the same division `useBoardGesture` makes.
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearHold = () => {
    if (holdTimer.current !== null) clearTimeout(holdTimer.current);
    holdTimer.current = null;
  };
  useEffect(() => clearHold, []);

  const sample = (event: ReactPointerEvent<HTMLElement>, host: HTMLElement) => {
    const bounds = host.getBoundingClientRect();
    return {
      point: { x: event.clientX - bounds.left, y: event.clientY - bounds.top },
      time: performance.now(),
    };
  };

  const wrapperRef = useRef<HTMLDivElement | null>(null);

  const onHandleDown = (rowId: string) => (event: ReactPointerEvent<HTMLDivElement>) => {
    const host = wrapperRef.current;
    if (!host) return;
    capturePointer(event.currentTarget, event.pointerId);
    const at = sample(event, host);
    send({ type: "down", rowId, at, layout: layoutRef.current, immediate });

    clearHold();
    holdTimer.current = setTimeout(() => {
      holdTimer.current = null;
      // The pointer has not moved, so the hold is reported where it went down.
      send({
        type: "hold",
        at: { point: at.point, time: performance.now() },
        layout: layoutRef.current,
      });
    }, DRAG_HOLD_MS);
  };

  const onHandleMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const host = wrapperRef.current;
    if (!host || rowDragRef.current.phase === "idle") return;
    send({ type: "move", at: sample(event, host), layout: layoutRef.current });
  };

  const onHandleUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const host = wrapperRef.current;
    clearHold();
    releasePointer(event.currentTarget, event.pointerId);
    if (!host) return;
    const out = send({ type: "up", at: sample(event, host), layout: layoutRef.current });
    // Touch has no hover, so a tap is its only way to reach the panel — the
    // same reasoning that gives a tile `onTap` on a touch device.
    if (out.tapped && !immediate) {
      const tapped = out.tapped.rowId;
      const label = layoutRef.current.rows.find((r) => r.rowId === tapped)?.labelRect;
      const labelPageX = host.getBoundingClientRect().left + (label?.x ?? 0);
      setOpen({ rowId: tapped, openRight: labelPageX < PANEL_WIDTH + 16 });
    }
  };

  const onHandleCancel = (event: ReactPointerEvent<HTMLDivElement>) => {
    clearHold();
    releasePointer(event.currentTarget, event.pointerId);
    send({ type: "cancel" });
  };

  /** Emits the right action for a size, honouring the resize-all mode. */
  const applySize = useCallback(
    (rowId: string, size: number) => {
      const clamped = clampTileSize(size);
      onAction(
        resizeAll
          ? { type: "display/setUniformTileSize", tileSize: clamped }
          : { type: "row/setTileSize", rowId, tileSize: clamped },
      );
    },
    [onAction, resizeAll],
  );

  // Corner-grip resizing. The size at grab time is held rather than read back
  // each frame, so the tier follows the pointer's total travel instead of
  // compounding its own growth into the next frame's delta.
  const gripRef = useRef<{ rowId: string; startSize: number; origin: { x: number; y: number } } | null>(
    null,
  );

  const onGripDown = (rowId: string) => (event: ReactPointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
    capturePointer(event.currentTarget, event.pointerId);
    gripRef.current = {
      rowId,
      startSize: effectiveSizeOf(doc, rowId),
      origin: { x: event.clientX, y: event.clientY },
    };
  };

  const onGripMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const grip = gripRef.current;
    if (!grip) return;
    event.stopPropagation();
    applySize(
      grip.rowId,
      grip.startSize +
        sizeDelta(event.clientX - grip.origin.x, event.clientY - grip.origin.y),
    );
  };

  const onGripUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    releasePointer(event.currentTarget, event.pointerId);
    gripRef.current = null;
  };

  const openRow = openRowId ? doc.rows.find((r) => r.id === openRowId) : undefined;
  // A tier can vanish under an open panel — removed, or an undo reaching past
  // when it was added. `row/rename` and friends no-op on a missing id, so
  // nothing corrupts, but a panel over a tier that is gone is worse than one
  // that closes.
  useEffect(() => {
    if (openRowId && !openRow) setOpen(null);
  }, [openRowId, openRow]);

  const draggingRowId = rowDrag.phase === "dragging" ? rowDrag.rowId : null;
  const caret =
    rowDrag.phase === "dragging"
      ? rowCaretRect(layout, rowDrag.toIndex, rowDrag.rowId)
      : null;

  const openLabelRect = openRow
    ? layout.rows.find((r) => r.rowId === openRow.id)?.labelRect
    : undefined;

  return (
    <div ref={wrapperRef} data-testid="tier-overlay-wrapper" style={wrapperStyle}>
      {children}

      <div style={overlayStyle}>
        {layout.rows.map((row) => {
          const model = doc.rows.find((r) => r.id === row.rowId);
          if (!model) return null;
          const isDragged = draggingRowId === row.rowId;
          const showAffordances = !dragging && (hovered === row.rowId || openRowId === row.rowId);

          return (
            <div
              key={row.rowId}
              data-testid="tier-handle"
              data-row-id={row.rowId}
              onPointerDown={onHandleDown(row.rowId)}
              onPointerMove={onHandleMove}
              onPointerUp={onHandleUp}
              onPointerCancel={onHandleCancel}
              onMouseEnter={() => setHovered(row.rowId)}
              onMouseLeave={() => setHovered((c) => (c === row.rowId ? null : c))}
              style={{
                position: "absolute",
                left: row.labelRect.x,
                top: row.labelRect.y,
                width: row.labelRect.width,
                height: row.labelRect.height,
                pointerEvents: "auto",
                cursor: isDragged ? "grabbing" : "grab",
                // The tier stays drawn on the canvas beneath; this only marks
                // the one being carried, the way a lifted tile is faded.
                background: isDragged ? "rgba(11,13,16,0.45)" : "transparent",
                touchAction: "none",
              }}
            >
              {showAffordances ? (
                <>
                  <button
                    type="button"
                    title="Edit tier"
                    aria-label="Edit tier"
                    data-testid="tier-edit-button"
                    // The handle beneath owns the drag; a click here means the
                    // panel and nothing else.
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      setOpen((current) => {
                        if (current?.rowId === row.rowId) return null;
                        // Measured, not derived from the layout: the panel
                        // opens into the page beside the board, and only the
                        // board's position in the viewport says whether there
                        // is room for it there.
                        const host = wrapperRef.current?.getBoundingClientRect();
                        const labelPageX = (host?.left ?? 0) + row.labelRect.x;
                        return {
                          rowId: row.rowId,
                          openRight: labelPageX < PANEL_WIDTH + 16,
                        };
                      });
                    }}
                    style={editButtonStyle(row.labelRect)}
                  >
                    <svg width={EDIT_SIZE * 0.55} height={EDIT_SIZE * 0.55} viewBox="0 0 24 24" aria-hidden="true">
                      <path
                        d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25ZM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83Z"
                        fill="currentColor"
                      />
                    </svg>
                  </button>

                  <div
                    role="slider"
                    tabIndex={0}
                    aria-label="Resize tier"
                    aria-valuenow={effectiveSizeOf(doc, row.rowId)}
                    data-testid="tier-resize-grip"
                    title="Drag to resize this tier"
                    onPointerDown={onGripDown(row.rowId)}
                    onPointerMove={onGripMove}
                    onPointerUp={onGripUp}
                    onPointerCancel={onGripUp}
                    style={gripStyle(row.labelRect)}
                  >
                    <svg width={GRIP_SIZE} height={GRIP_SIZE} viewBox="0 0 16 16" aria-hidden="true">
                      <path
                        d="M15 8 8 15M15 12l-3 3"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        fill="none"
                      />
                    </svg>
                  </div>
                </>
              ) : null}
            </div>
          );
        })}

        {caret ? (
          <div
            data-testid="tier-caret"
            style={{
              position: "absolute",
              left: caret.x,
              top: caret.y,
              width: caret.width,
              height: caret.height,
              background: "#4ade80",
              borderRadius: caret.height,
            }}
          />
        ) : null}

        {open && openRow && openLabelRect ? (
          <TierPanel
            row={openRow}
            labelRect={openLabelRect}
            effectiveSize={effectiveSizeOf(doc, openRow.id)}
            resizeAll={resizeAll}
            onResizeAllChange={(next) => {
              setResizeAll(next);
              // Ticking it equalises immediately, at the size the panel is
              // showing. A checkbox that changed nothing until some *other*
              // control moved would read as broken.
              if (next) {
                onAction({
                  type: "display/setUniformTileSize",
                  tileSize: clampTileSize(effectiveSizeOf(doc, openRow.id)),
                });
              }
            }}
            onRename={(label) => onAction({ type: "row/rename", rowId: openRow.id, label })}
            onRecolor={(color) => onAction({ type: "row/recolor", rowId: openRow.id, color })}
            onSize={(size) => applySize(openRow.id, size)}
            onRemove={() => {
              onAction({ type: "row/remove", rowId: openRow.id });
              setOpen(null);
            }}
            onClose={() => setOpen(null)}
            openRight={open.openRight}
          />
        ) : null}
      </div>

      <button
        type="button"
        data-testid="tier-add"
        onClick={() =>
          onAddRow("", PALETTE[doc.rows.length % PALETTE.length]!)
        }
        style={addButtonStyle}
      >
        + Add tier
      </button>
    </div>
  );
}

/**
 * Colours a new tier is given, in the order `createTierList` uses them, so a
 * tier added by hand looks like it belongs beside the ones that came with the
 * document.
 */
const PALETTE = ["#ff7f7f", "#ffbf7f", "#ffff7f", "#bfff7f", "#7fbfff", "#bf9fff"];

function editButtonStyle(label: Rect): CSSProperties {
  return {
    position: "absolute",
    right: INSET,
    top: INSET,
    width: EDIT_SIZE,
    height: EDIT_SIZE,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
    borderRadius: "50%",
    background: "rgba(11, 13, 16, 0.75)",
    border: "1px solid rgba(230, 237, 243, 0.4)",
    color: "#e6edf3",
    cursor: "pointer",
    pointerEvents: "auto",
    // A CSS keyframe rather than a state flip on `requestAnimationFrame`: an
    // animation runs from the element's own style, and with `fill-mode: none`
    // the settled state is the element's own — so where animations do not run
    // the button is visible rather than stuck invisible.
    animation: "tl-tile-edit-button-in 120ms ease-out",
    // Silences the unused parameter without loosening the signature: callers
    // pass the rect so this can grow to scale with the cell.
    ...(label.width < EDIT_SIZE + INSET * 2 ? { display: "none" } : null),
  };
}

function gripStyle(label: Rect): CSSProperties {
  return {
    position: "absolute",
    right: 0,
    bottom: 0,
    width: GRIP_SIZE,
    height: GRIP_SIZE,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "rgba(11, 13, 16, 0.85)",
    cursor: "nwse-resize",
    pointerEvents: "auto",
    touchAction: "none",
    animation: "tl-tile-edit-button-in 120ms ease-out",
    ...(label.width < GRIP_SIZE || label.height < GRIP_SIZE ? { display: "none" } : null),
  };
}

const wrapperStyle: CSSProperties = {
  position: "relative",
};

const overlayStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  // Everything not explicitly interactive falls through to the canvas, so the
  // tile drag beneath keeps every event this layer does not claim.
  pointerEvents: "none",
};

const addButtonStyle: CSSProperties = {
  marginTop: 8,
  background: "#171c22",
  border: "1px dashed #2c3540",
  borderRadius: 6,
  color: "#8b98a6",
  padding: "8px 12px",
  cursor: "pointer",
  fontFamily: "system-ui, sans-serif",
  fontSize: 13,
  width: "100%",
};
