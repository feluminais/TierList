"use client";

import { DEFAULT_STROKE_WIDTH, type ImageEdit, type Item, type TierListAction } from "@tl/core";
import {
  cropReduce,
  editReduce,
  idleCrop,
  idleEdit,
  maxZoomFor,
  strokeWidthInTile,
  toTilePoint,
  zoomOf,
  type CropContext,
  type CropEvent,
  type CropState,
  type EditContext,
  type EditEvent,
  type EditState,
} from "@tl/editor-core";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";

/**
 * The sheet canvas's longest side, in css px. The other side follows the
 * tile's aspect, because the canvas *is* the tile here — one tile blown up,
 * not a board scaled — which is what lets the same pure machines serve a 96px
 * board tile and this sheet without knowing which one they are talking to.
 * A square sheet showing a portrait tile would frame a crop the board then
 * cropped further, and the user would only find out after pressing Done.
 */
const SHEET_LONG_SIDE = 600;

/**
 * A ceiling on the samples one stroke may carry.
 *
 * Capped here rather than in `editReduce`, whose contract is to record every
 * point it is given: deciding which samples are worth keeping belongs to the
 * surface generating them. Thinning cost grows sharply with the count, and a
 * fast gesture on a high-refresh screen produces far more samples than a
 * stroke needs, so this bounds it well above any real stroke.
 */
const MAX_STROKE_SAMPLES = 1200;

const STROKE_COLOR = "#e6edf3";

/**
 * How long after the last wheel notch a zoom run counts as finished.
 *
 * A wheel has no "up" event, so something has to decide where the gesture
 * ends, and `cropReduce` will not read a clock — the same division
 * `useBoardGesture` makes for the drag machine's hold timer. Long enough that
 * a normal roll of a wheel or a trackpad flick stays one undo step; short
 * enough that a zoom is on its way to the server before the user has finished
 * looking at it.
 */
const ZOOM_IDLE_MS = 220;

/** One wheel notch, as a zoom factor. `deltaY` is scaled by this exponentially. */
const WHEEL_ZOOM_PER_PIXEL = 0.0015;

export type SheetMode = "crop" | "draw";

/**
 * A stroke not yet committed, in the sheet canvas's own coordinate space —
 * both its points and its width, so the canvas draws it without converting
 * anything.
 */
export interface LiveStrokeProps {
  points: number[]; // flat [x0, y0, x1, y1, …]
  color: string;
  /** Canvas pixels, not the document's source-relative fraction. */
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
  width: number;
  height: number;
  assetUrl: (assetId: string) => string;
  liveStroke: LiveStrokeProps | null;
}>;

export interface EditSheetProps {
  item: Item;
  /** `@tl/editor`'s `EditCanvas`, already loaded by `SkiaHost`. */
  EditCanvas: EditCanvasComponent;
  /**
   * Height ÷ width of a tile — `aspectRatioFor(doc.display.tileAspect)`. The
   * number rather than the `TileAspect` name, so this file never grows a
   * second copy of the mapping `layoutBoard` owns.
   */
  tileAspect: number;
  assetUrl: (assetId: string) => string;
  onAction: (action: TierListAction) => void;
  onClose: () => void;
}

/**
 * Remove the item this sheet is open on.
 *
 * The sheet is the one surface that names a single item, so it is where
 * deleting one belongs. No confirmation: it is a single undo step, and the
 * board shows immediately what went.
 */
function removeItem(
  itemId: string,
  onAction: (action: TierListAction) => void,
  onClose: () => void,
): void {
  onAction({ type: "item/remove", itemId });
  onClose();
}

/**
 * A full-bleed overlay for reframing and scribbling on one tile.
 *
 * Two surfaces, one sheet, exactly as the design doc merges crop and draw:
 * one edit sheet, one layer stack, one commit-to-tile pipeline. Both are
 * driven by pure machines in `@tl/editor-core` — `cropReduce` and
 * `editReduce` — and both hold to the same contract: one gesture, one
 * `item/setEdit`, emitted when the gesture ends and never before. The
 * document is not touched while the user is still moving, exactly as the
 * board is not touched until a drop, and that is what makes a reframe one
 * undo step, one revision and one autosave.
 *
 * There is no separate save button: autosave already picks up whatever
 * `onAction` dispatches, and a sheet that saved again on top of that would
 * double-apply the same edit.
 *
 * Wired on the overlay's own DOM element with plain pointer events rather
 * than the responder system `useBoardGesture` uses — this is a plain web
 * overlay, not a board tile competing with a scroll container, so pointer
 * events are enough here.
 */
export function EditSheet({
  item,
  EditCanvas,
  tileAspect,
  assetUrl,
  onAction,
  onClose,
}: EditSheetProps) {
  // Crop is meaningless without an image, so a text tile opens on the pen and
  // never offers the other tab at all.
  const croppable = !!item.assetId;
  const [mode, setMode] = useState<SheetMode>(croppable ? "crop" : "draw");

  const [edit, setEdit] = useState<EditState>(idleEdit);
  const [crop, setCrop] = useState<CropState>(idleCrop);

  // The one source of truth `send` reads and writes. `pointermove` fires
  // faster than React renders and React batches state updates, so two moves in
  // one batch would both reduce against the state that last rendered and the
  // earlier one would be lost. Writing the ref synchronously inside `send`,
  // before `setState`, means the next event in the same batch reads what the
  // previous one produced. There is no second assignment anywhere else: two
  // places that can each set these is the disagreement this removes.
  const editRef = useRef(edit);
  const cropRef = useRef(crop);

  const canvas = useMemo(() => sheetSize(tileAspect), [tileAspect]);
  // Stable for as long as the canvas is: the sheet does not resize while open.
  const tile = useMemo(
    () => ({ x: 0, y: 0, width: canvas.width, height: canvas.height }),
    [canvas.width, canvas.height],
  );

  const penContext: EditContext = useMemo(
    () => ({ itemId: item.id, tile, edit: item.edit, tolerance: 0.002 }),
    [item.id, tile, item.edit],
  );
  const cropContext: CropContext = useMemo(
    () => ({ itemId: item.id, tile, edit: item.edit }),
    [item.id, tile, item.edit],
  );
  // Read by handlers and by the idle timer, both of which can fire against a
  // context newer than the one their closure captured.
  const cropContextRef = useRef(cropContext);
  cropContextRef.current = cropContext;

  const sendPen = (event: EditEvent) => {
    const out = editReduce(editRef.current, event);
    editRef.current = out.state;
    setEdit(out.state);
    if (out.action) onAction(out.action);
  };

  const sendCrop = useCallback(
    (event: CropEvent) => {
      const out = cropReduce(cropRef.current, event);
      cropRef.current = out.state;
      setCrop(out.state);
      if (out.action) onAction(out.action);
    },
    [onAction],
  );

  // Owned here rather than in the machine, which never reads a clock.
  const zoomTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const endZoomSoon = useCallback(() => {
    if (zoomTimer.current !== null) clearTimeout(zoomTimer.current);
    zoomTimer.current = setTimeout(() => {
      zoomTimer.current = null;
      sendCrop({ type: "zoomEnd", context: cropContextRef.current });
    }, ZOOM_IDLE_MS);
  }, [sendCrop]);

  /**
   * Commit any zoom still sitting behind the idle timer, right now.
   *
   * Without this, zooming and immediately pressing Done loses the reframe:
   * the sheet unmounts, the timer is cleared on the way out, and the action
   * that would have carried the crop is never emitted. Closing is the one
   * moment the gesture is definitely over, so waiting out the timer there is
   * only a way to lose work.
   */
  const flushZoom = useCallback(() => {
    if (zoomTimer.current === null) return;
    clearTimeout(zoomTimer.current);
    zoomTimer.current = null;
    sendCrop({ type: "zoomEnd", context: cropContextRef.current });
  }, [sendCrop]);

  useEffect(() => {
    return () => {
      if (zoomTimer.current !== null) clearTimeout(zoomTimer.current);
    };
  }, []);

  const pointFromEvent = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    if (mode === "crop") {
      sendCrop({ type: "panStart", at: pointFromEvent(event), context: cropContext });
      return;
    }
    sendPen({
      type: "penDown",
      at: pointFromEvent(event),
      context: penContext,
      strokeId: newStrokeId(),
      color: STROKE_COLOR,
      width: DEFAULT_STROKE_WIDTH,
    });
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (mode === "crop") {
      // `cropReduce` ignores a move with no pan under way, so there is no
      // guard here. A guard reading the `crop` state variable rather than the
      // ref would see the previous render's phase and drop the start of every
      // pan; see the pen path below, which reads the ref for that reason.
      sendCrop({ type: "panMove", at: pointFromEvent(event), context: cropContext });
      return;
    }
    // Reads `editRef.current`, not the `edit` state variable this closure was
    // built with: the same batching that drops points can also leave this
    // guard looking at the *previous* render's phase, which is still "idle"
    // for the first move or two right after `penDown` while its own render is
    // still pending — dropping the start of every stroke.
    const current = editRef.current;
    if (current.phase !== "drawing") return;
    if (current.points.length / 2 >= MAX_STROKE_SAMPLES) return;
    sendPen({ type: "penMove", at: pointFromEvent(event), context: penContext });
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (mode === "crop") {
      sendCrop({ type: "panEnd", at: pointFromEvent(event), context: cropContext });
      return;
    }
    sendPen({ type: "penUp", at: pointFromEvent(event), context: penContext });
  };

  const onPointerCancel = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (mode === "crop") sendCrop({ type: "cancel" });
    else sendPen({ type: "cancel" });
  };

  /**
   * The wheel is attached natively rather than through React's `onWheel`.
   *
   * React registers its root `wheel` listener as **passive**, so
   * `preventDefault` inside an `onWheel` handler does nothing — and without
   * it, rolling the wheel over the sheet scrolls the page behind the overlay
   * while zooming the crop. A non-passive listener on the element itself is
   * the only way to claim the gesture.
   */
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const cropping = mode === "crop";
  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface || !cropping) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = surface.getBoundingClientRect();
      sendCrop({
        type: "zoomBy",
        // Exponential in the wheel's own units, so one notch is the same
        // proportional step wherever the zoom currently sits — a linear factor
        // would crawl when zoomed out and lurch when zoomed in. Negated
        // because `deltaY` is positive scrolling *down*, which conventionally
        // zooms out.
        factor: Math.exp(-event.deltaY * WHEEL_ZOOM_PER_PIXEL),
        at: { x: event.clientX - rect.left, y: event.clientY - rect.top },
        context: cropContextRef.current,
      });
      endZoomSoon();
    };
    surface.addEventListener("wheel", onWheel, { passive: false });
    return () => surface.removeEventListener("wheel", onWheel);
  }, [cropping, sendCrop, endZoomSoon]);

  // What is on screen: the gesture's own crop while one is in flight, the
  // document's otherwise. The sheet renders this rather than `item.edit`
  // because the document deliberately does not move until the gesture ends.
  const workingCrop = crop.phase === "active" ? crop.crop : item.edit.crop;
  const shownItem: Item = useMemo(
    () =>
      workingCrop === item.edit.crop
        ? item
        : { ...item, edit: { ...item.edit, crop: workingCrop } },
    [item, workingCrop],
  );

  // `edit.points` is source-normalized, exactly like a committed stroke's
  // `points` — never tile coordinates and never the crop — so drawing it
  // needs the same `toTilePoint` a committed stroke goes through in
  // `EditCanvas`/`TierBoard`. Skipping this would either park the live line
  // in the wrong place or scale it into a corner the moment the crop isn't
  // the untouched full-frame default. Mapped through `workingCrop`, not
  // `item.edit.crop`, so it tracks a reframe in progress like everything else.
  const liveStroke: LiveStrokeProps | null =
    edit.phase === "drawing"
      ? {
          points: mapToTile(edit.points, tile, workingCrop),
          color: edit.color,
          // Converted here alongside the points, and by the same scale, so the
          // line under the pointer is the width the committed stroke will have.
          width: strokeWidthInTile(edit.width, tile, workingCrop),
        }
      : null;

  const zoom = zoomOf(workingCrop);
  const zoomMax = maxZoomFor(workingCrop);

  const close = () => {
    flushZoom();
    onClose();
  };

  return (
    <div style={overlay}>
      <div style={sheet}>
        <div style={tabBar}>
          {croppable ? (
            <>
              <button
                type="button"
                data-testid="sheet-mode-crop"
                aria-pressed={mode === "crop"}
                onClick={() => setMode("crop")}
                style={tab(mode === "crop")}
              >
                Crop
              </button>
              <button
                type="button"
                data-testid="sheet-mode-draw"
                aria-pressed={mode === "draw"}
                onClick={() => setMode("draw")}
                style={tab(mode === "draw")}
              >
                Draw
              </button>
            </>
          ) : (
            <span style={{ color: "#8b98a6", fontSize: 13 }}>Draw</span>
          )}

          {cropping ? (
            <label style={zoomLabel}>
              Zoom
              <input
                aria-label="Zoom"
                data-testid="crop-zoom"
                type="range"
                min={0}
                max={1}
                step={0.001}
                // Logarithmic. The useful part of the range is the first
                // couple of multiples, and on a linear 1..~37 slider that is
                // the first five per cent of the travel.
                value={zoomMax > 1 ? Math.log(zoom) / Math.log(zoomMax) : 0}
                onChange={(event) => {
                  const t = Number(event.target.value);
                  sendCrop({
                    type: "zoomTo",
                    zoom: Math.exp(t * Math.log(zoomMax)),
                    context: cropContext,
                  });
                  // `input` fires continuously and `change` fires when the
                  // handle is released — but React's `onChange` on a range
                  // *is* the `input` event, so the run is ended by the same
                  // idle timer the wheel uses rather than by a release event
                  // this component never sees.
                  endZoomSoon();
                }}
              />
            </label>
          ) : null}
        </div>

        <div
          ref={surfaceRef}
          data-testid="edit-sheet-canvas"
          style={{
            width: canvas.width,
            height: canvas.height,
            touchAction: "none",
            cursor: cropping ? "grab" : "crosshair",
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
        >
          <EditCanvas
            item={shownItem}
            width={canvas.width}
            height={canvas.height}
            assetUrl={assetUrl}
            liveStroke={liveStroke}
          />
        </div>

        <p style={hint}>
          {cropping
            ? "Drag to reframe · scroll or use the slider to zoom"
            : "Drag to draw on the tile"}
        </p>

        <div style={{ display: "flex", gap: 8, alignSelf: "stretch" }}>
          <button
            type="button"
            data-testid="edit-sheet-remove"
            title="Remove this item from the list"
            onClick={() => removeItem(item.id, onAction, onClose)}
            style={removeButton}
          >
            Remove
          </button>
          <button
            type="button"
            data-testid="edit-sheet-done"
            onClick={close}
            style={{ ...doneButton, flex: 1 }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * The sheet canvas's pixel size for a given tile aspect (height ÷ width),
 * with the longer side pinned to `SHEET_LONG_SIDE` so neither a portrait nor
 * a landscape tile can overflow the viewport in its long direction.
 */
function sheetSize(tileAspect: number): { width: number; height: number } {
  // A non-finite or non-positive aspect can only reach here from a document
  // nothing validated. Falling back to square keeps the sheet usable rather
  // than sizing the canvas to NaN, which renders nothing at all and gives the
  // user no way to see that anything is wrong.
  if (!(tileAspect > 0) || !Number.isFinite(tileAspect)) {
    return { width: SHEET_LONG_SIDE, height: SHEET_LONG_SIDE };
  }
  return tileAspect >= 1
    ? { width: Math.round(SHEET_LONG_SIDE / tileAspect), height: SHEET_LONG_SIDE }
    : { width: SHEET_LONG_SIDE, height: Math.round(SHEET_LONG_SIDE * tileAspect) };
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
  fontFamily: "system-ui, sans-serif",
};

const tabBar: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  alignSelf: "stretch",
};

const zoomLabel: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  marginLeft: "auto",
  color: "#8b98a6",
  fontSize: 13,
};

const hint: CSSProperties = {
  margin: 0,
  alignSelf: "stretch",
  color: "#5b6673",
  fontSize: 12,
};

function tab(active: boolean): CSSProperties {
  return {
    background: active ? "#2b3542" : "#171c22",
    border: `1px solid ${active ? "#3b8beb" : "#2c3540"}`,
    borderRadius: 6,
    color: active ? "#e6edf3" : "#8b98a6",
    padding: "6px 14px",
    cursor: "pointer",
    fontFamily: "inherit",
  };
}

const doneButton: CSSProperties = {
  background: "#222b35",
  border: "1px solid #2c3540",
  borderRadius: 6,
  color: "#e6edf3",
  padding: "8px 20px",
  cursor: "pointer",
  fontFamily: "inherit",
  alignSelf: "stretch",
};

const removeButton: CSSProperties = {
  ...doneButton,
  background: "#2b1c1e",
  border: "1px solid #4a2f33",
  color: "#f5a3a3",
};
