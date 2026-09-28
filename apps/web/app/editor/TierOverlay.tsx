"use client";

import { DOCUMENT_LIMITS, TIER_PALETTE, type TierList, type TierListAction } from "@tl/core";
import {
  DRAG_HOLD_MS,
  clampLabelWidth,
  clampTileSize,
  idleRowDrag,
  rowCaretRect,
  rowDragReduce,
  type BoardLayout,
  type Rect,
  type RowDragEvent,
  type RowDragState,
} from "@tl/editor-core";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { PANEL_WIDTH, TierPanel } from "./TierPanel";

/** The corner grip's size, in px. */
const GRIP_SIZE = 16;
/** The add-tier tab, tucked into the bottom of the last tier's cell. */
const ADD_TIER_WIDTH = 44;
const ADD_TIER_HEIGHT = 18;

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
  /** The layout the canvas was drawn from — shared, never recomputed here. */
  layout: BoardLayout;
  /** True while a *tile* drag is in flight; tier affordances stand down. */
  dragging: boolean;
  /**
   * Whether a press may become a drag on movement alone, without the hold.
   * Set for a precise pointer, exactly as `InteractiveBoard`'s `immediateDrag`
   * is, and for the same reason: a mouse has no page scroll to steal.
   */
  immediate: boolean;
  onAction: (action: TierListAction) => void;
  /**
   * Dispatches several actions as one edit — one undo step, one revision.
   *
   * The corner grip needs it: a diagonal drag changes this tier's tile size
   * *and* the width of the label column, which are two settings and therefore
   * two actions, but one thing the user did.
   */
  onActions: (actions: readonly TierListAction[]) => void;
  /** The label and colour alone; the id is minted at the call site. */
  onAddRow: (label: string, color: string) => void;
  /** Opens the sheet that creates an item. */
  onAddItem: () => void;
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
  layout,
  dragging,
  immediate,
  onAction,
  onActions,
  onAddRow,
  onAddItem,
  children,
}: TierOverlayProps) {

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
   * Open the panel on a tier, or close it if that tier's panel is already open.
   *
   * The tier itself is the control — there is no separate edit button — so
   * this is what a click on a tier means, and clicking it again is what closes
   * it. The direction is measured here rather than derived from the layout,
   * for the reason `open` documents.
   */
  const togglePanel = useCallback((rowId: string, labelX: number) => {
    setOpen((current) => {
      if (current?.rowId === rowId) return null;
      const host = wrapperRef.current?.getBoundingClientRect();
      const labelPageX = (host?.left ?? 0) + labelX;
      return { rowId, openRight: labelPageX < PANEL_WIDTH + 16 };
    });
  }, []);

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
  // The open panel's own element, so a press inside it can be told from a
  // press on the board behind it.
  const panelRef = useRef<HTMLDivElement | null>(null);

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
    // A press that did not become a drag is a click on the tier, and a click
    // on the tier is what opens its panel — on a mouse as well as on touch.
    // `rowDragReduce` reports the tap either way; what differs between the two
    // is only how a press is promoted to a drag, which it has already decided
    // by the time this runs.
    if (out.tapped) {
      const tapped = out.tapped.rowId;
      const label = layoutRef.current.rows.find((r) => r.rowId === tapped)?.labelRect;
      togglePanel(tapped, label?.x ?? 0);
    }
  };

  const onHandleCancel = (event: ReactPointerEvent<HTMLDivElement>) => {
    clearHold();
    releasePointer(event.currentTarget, event.pointerId);
    send({ type: "cancel" });
  };

  /**
   * Corner-grip resizing, both ways.
   *
   * Horizontal travel widens the **label column** and vertical travel changes
   * this tier's **tile size**, because those are the two things about a tier
   * that can actually change: a tier spans the whole board, so its own width
   * is not a free variable — the width of its coloured cell is. Mapping both
   * axes onto one number, as this used to, meant a horizontal pull only ever
   * made the row taller and the cell never got wider.
   *
   * The label column is one column for every tier, so widening it widens them
   * all. That is not a compromise: labels that did not line up would not be a
   * column.
   *
   * The size at grab time is held rather than read back each frame, so the
   * tier follows the pointer's total travel instead of compounding its own
   * growth into the next frame's delta.
   */
  const gripRef = useRef<{
    rowId: string;
    startSize: number;
    startLabelWidth: number;
    origin: { x: number; y: number };
  } | null>(null);

  const onGripDown = (rowId: string) => (event: ReactPointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
    capturePointer(event.currentTarget, event.pointerId);
    gripRef.current = {
      rowId,
      startSize: effectiveSizeOf(doc, rowId),
      startLabelWidth: doc.display.labelWidth,
      origin: { x: event.clientX, y: event.clientY },
    };
  };

  const onGripMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const grip = gripRef.current;
    if (!grip) return;
    event.stopPropagation();

    const tileSize = clampTileSize(grip.startSize + (event.clientY - grip.origin.y));
    const labelWidth = clampLabelWidth(
      grip.startLabelWidth + (event.clientX - grip.origin.x),
    );

    // One batch, so a diagonal drag is one undo step rather than two — and so
    // every frame of it carries the same merge key and coalesces, which two
    // separate dispatches alternating between two keys would not.
    onActions([
      { type: "display/set", patch: { labelWidth } },
      { type: "row/setTileSize", rowId: grip.rowId, tileSize },
    ]);
  };

  const onGripUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    releasePointer(event.currentTarget, event.pointerId);
    gripRef.current = null;
  };

  /**
   * A press anywhere that is not the panel closes it.
   *
   * On the *wrapper*, not on `window`, and not a full-screen backdrop: the
   * board beneath takes its own pointer events for the tile drag, and a
   * backdrop over it would cost every drag while the panel is open.
   *
   * The panel and the colour popover are excluded by containment rather than
   * by stopping propagation inside them, because the popover clamps itself to
   * the viewport and can therefore sit outside the panel's box while still
   * being part of it — `contains` follows the DOM, which is what "inside the
   * panel" actually means.
   *
   * The tier cells are excluded too: a press on one is a press on a control
   * that already decides for itself whether to open, close or start a drag,
   * and closing here first would make a click on another tier open nothing.
   *
   * `pointerdown` rather than `click`, so the panel is gone before whatever
   * was pressed acts.
   */
  useEffect(() => {
    if (!openRowId) return;
    const host = wrapperRef.current;
    if (!host) return;

    const onDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (panelRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest('[data-testid="tier-handle"]')) return;
      setOpen(null);
    };

    host.addEventListener("pointerdown", onDown);
    return () => host.removeEventListener("pointerdown", onDown);
  }, [openRowId]);

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

  const lastRow = layout.rows[layout.rows.length - 1];

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

        {/*
          Add a tier from the bottom of the tier column, where the next one
          will appear — rather than from a bar under the board, which is
          nowhere near the thing it creates. Inside the last tier's cell so it
          cannot overlap the tray beneath. Gone once the list holds as many
          tiers as a document may, where `reduce` would ignore the press.
        */}
        {lastRow && !dragging && doc.rows.length < DOCUMENT_LIMITS.rows ? (
          <button
            type="button"
            data-testid="tier-add"
            title="Add a tier"
            aria-label="Add a tier"
            onClick={() => onAddRow("", TIER_PALETTE[doc.rows.length % TIER_PALETTE.length]!)}
            style={{
              position: "absolute",
              left: lastRow.labelRect.x + lastRow.labelRect.width / 2 - ADD_TIER_WIDTH / 2,
              top: lastRow.labelRect.y + lastRow.labelRect.height - ADD_TIER_HEIGHT,
              width: ADD_TIER_WIDTH,
              height: ADD_TIER_HEIGHT,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 0,
              border: "none",
              borderRadius: `${ADD_TIER_HEIGHT / 2}px ${ADD_TIER_HEIGHT / 2}px 0 0`,
              background: "rgba(11, 13, 16, 0.55)",
              color: "#e6edf3",
              fontSize: 15,
              lineHeight: 1,
              cursor: "pointer",
              pointerEvents: "auto",
            }}
          >
            +
          </button>
        ) : null}

        {/*
          Adding an item starts where the item will appear: the first slot of
          the tray, which `layoutBoard` reserves so the tiles after it move
          along rather than sitting underneath.
        */}
        {layout.tray.addSlot && !dragging ? (
          <button
            type="button"
            data-testid="add-item"
            title="Add an item"
            aria-label="Add an item"
            onClick={onAddItem}
            style={{
              position: "absolute",
              left: layout.tray.addSlot.x,
              top: layout.tray.addSlot.y,
              width: layout.tray.addSlot.width,
              height: layout.tray.addSlot.height,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "rgba(230, 237, 243, 0.06)",
              border: "1px dashed rgba(230, 237, 243, 0.28)",
              borderRadius: 8,
              color: "#8b98a6",
              fontSize: Math.max(20, layout.tray.addSlot.width * 0.34),
              lineHeight: 1,
              cursor: "pointer",
              pointerEvents: "auto",
            }}
          >
            +
          </button>
        ) : null}

        {open && openRow && openLabelRect ? (
          <TierPanel
            ref={panelRef}
            row={openRow}
            labelRect={openLabelRect}
            onRename={(label) => onAction({ type: "row/rename", rowId: openRow.id, label })}
            onRecolor={(color) => onAction({ type: "row/recolor", rowId: openRow.id, color })}
            onBold={(bold) => onAction({ type: "row/setBold", rowId: openRow.id, bold })}
            onRemove={() => {
              onAction({ type: "row/remove", rowId: openRow.id });
              setOpen(null);
            }}
            onClose={() => {
              setOpen(null);
            }}
            openRight={open.openRight}
          />
        ) : null}
      </div>

    </div>
  );
}

/**
 * Colours a new tier is given, in the order `createTierList` uses them, so a
 * tier added by hand looks like it belongs beside the ones that came with the
 * document.
 */


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

