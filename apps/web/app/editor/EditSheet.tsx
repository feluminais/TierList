"use client";

import type { ImageEdit, Item, TierListAction } from "@tl/core";
import {
  editReduce,
  idleEdit,
  toTilePoint,
  type EditContext,
  type EditEvent,
  type EditState,
} from "@tl/editor-core";
import {
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";

/**
 * The sheet's canvas, in css px. Square, so its own bounds double as the
 * `EditContext.tile` rect `editReduce` reasons about — the canvas *is* the
 * tile here, not a board scaled up, which is what lets the same pure gesture
 * machine serve a 96px board tile and this 600px sheet without knowing which
 * one it is talking to.
 */
const SHEET_SIZE = 600;

/**
 * Points are capped here, not in `editReduce`: the machine's contract is to
 * record every point it is given, and deciding which samples are worth
 * keeping is the concern of the surface generating them. `simplifyPoints` is
 * O(n²) worst case, and a fast scribble on a high-refresh screen can produce
 * tens of thousands of raw samples; 1,200 is roughly ten seconds at 120Hz —
 * well past any single stroke — so it bounds the cost at something nobody
 * will ever feel.
 */
const MAX_STROKE_SAMPLES = 1200;

const STROKE_COLOR = "#e6edf3";
const STROKE_WIDTH = 4;

/** A stroke not yet committed, in the sheet canvas's own coordinate space. */
export interface LiveStrokeProps {
  points: number[]; // flat [x0, y0, x1, y1, …]
  color: string;
  width: number;
}

/**
 * The shape of `@tl/editor`'s `EditCanvas`, restated here rather than
 * imported.
 *
 * This file must not import `@tl/editor` — even for a type-only import,
 * which the compiler erases but which would still tie this module to a
 * package whose own modules build a Skia API object at load time
 * (`Skia.web.js`). `SkiaHost` loads that package with two ordered dynamic
 * imports specifically so nothing evaluates it before CanvasKit is on the
 * global; this file receives the already-loaded component as a prop instead,
 * the same way `SkiaHost` receives `Board`.
 */
export type EditCanvasComponent = ComponentType<{
  item: Item;
  size: number;
  assetUrl: (assetId: string) => string;
  liveStroke: LiveStrokeProps | null;
}>;

export interface EditSheetProps {
  item: Item;
  /** `@tl/editor`'s `EditCanvas`, already loaded by `SkiaHost`. */
  EditCanvas: EditCanvasComponent;
  assetUrl: (assetId: string) => string;
  onAction: (action: TierListAction) => void;
  onClose: () => void;
}

/**
 * A full-bleed overlay for scribbling on one tile.
 *
 * Driven by `editReduce`: one gesture, one `item/setEdit`, committed at
 * `penUp` and never before — the document is not touched while the user is
 * still drawing, exactly as the board is not touched until a drop. There is
 * no separate save button: autosave already picks up whatever `onAction`
 * dispatches, and a sheet that saved again on top of that would double-apply
 * the same stroke.
 *
 * Wired on the overlay's own DOM element with plain pointer events rather
 * than the responder system `useBoardGesture` uses — this is a plain web
 * overlay, not a board tile competing with a scroll container, so pointer
 * events are enough here.
 */
export function EditSheet({ item, EditCanvas, assetUrl, onAction, onClose }: EditSheetProps) {
  const [edit, setEdit] = useState<EditState>(idleEdit);
  const editRef = useRef(edit);
  editRef.current = edit;

  // Stable for the sheet's lifetime: the canvas never resizes while open.
  const tile = useMemo(() => ({ x: 0, y: 0, width: SHEET_SIZE, height: SHEET_SIZE }), []);
  const context: EditContext = useMemo(
    () => ({ itemId: item.id, tile, edit: item.edit, tolerance: 0.002 }),
    [item.id, tile, item.edit],
  );

  const send = (event: EditEvent) => {
    const out = editReduce(editRef.current, event);
    setEdit(out.state);
    if (out.action) onAction(out.action);
  };

  const pointFromEvent = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    send({
      type: "penDown",
      at: pointFromEvent(event),
      context,
      strokeId: newStrokeId(),
      color: STROKE_COLOR,
      width: STROKE_WIDTH,
    });
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (edit.phase !== "drawing") return;
    if (edit.points.length / 2 >= MAX_STROKE_SAMPLES) return;
    send({ type: "penMove", at: pointFromEvent(event), context });
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    send({ type: "penUp", at: pointFromEvent(event), context });
  };

  const onPointerCancel = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    send({ type: "cancel" });
  };

  // `edit.points` is source-normalized, exactly like a committed stroke's
  // `points` — never tile coordinates and never the crop — so drawing it
  // needs the same `toTilePoint` a committed stroke goes through in
  // `EditCanvas`/`TierBoard`. Skipping this would either park the live line
  // in the wrong place or scale it into a corner the moment the crop isn't
  // the untouched full-frame default; both are wrong only visually, which is
  // exactly why this is called out for a human to check in the Task 5 drive.
  const liveStroke: LiveStrokeProps | null =
    edit.phase === "drawing"
      ? {
          points: mapToTile(edit.points, tile, item.edit.crop),
          color: edit.color,
          width: edit.width,
        }
      : null;

  return (
    <div style={overlay}>
      <div style={sheet}>
        <div
          data-testid="edit-sheet-canvas"
          style={{ width: SHEET_SIZE, height: SHEET_SIZE, touchAction: "none" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
        >
          <EditCanvas item={item} size={SHEET_SIZE} assetUrl={assetUrl} liveStroke={liveStroke} />
        </div>
        <button type="button" data-testid="edit-sheet-done" onClick={onClose} style={doneButton}>
          Done
        </button>
      </div>
    </div>
  );
}

function mapToTile(
  points: number[],
  tile: { x: number; y: number; width: number; height: number },
  crop: ImageEdit["crop"],
): number[] {
  const out: number[] = [];
  for (let p = 0; p + 1 < points.length; p += 2) {
    const mapped = toTilePoint({ x: points[p]!, y: points[p + 1]! }, tile, crop);
    out.push(mapped.x, mapped.y);
  }
  return out;
}

/**
 * A fresh stroke id. Mirrors `newId` in `SkiaHost` — `crypto.randomUUID`
 * where available, a non-cryptographic fallback where it is not (a plain
 * http origin on a LAN, which is exactly how a phone reaches a dev server).
 */
function newStrokeId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `stroke-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const overlay: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.7)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 50,
};

const sheet: CSSProperties = {
  background: "#12161b",
  border: "1px solid #232a33",
  borderRadius: 8,
  padding: 16,
  display: "flex",
  flexDirection: "column",
  gap: 12,
  alignItems: "center",
};

const doneButton: CSSProperties = {
  background: "#222b35",
  border: "1px solid #2c3540",
  borderRadius: 6,
  color: "#e6edf3",
  padding: "8px 20px",
  cursor: "pointer",
  fontFamily: "system-ui, sans-serif",
  alignSelf: "stretch",
};
