import type { ImageEdit, TierListAction } from "@tl/core";
import type { Point, Rect } from "./geometry";
import { toSourcePoint } from "./strokes";

/** A normalized 0..1 rectangle of a source image. */
export type Crop = ImageEdit["crop"];

/**
 * The smallest fraction of a source a crop may shrink to.
 *
 * Not arbitrary: below this, one source pixel covers so much of the tile that
 * the result is unreadable, and the arithmetic starts losing precision in
 * normalized space. A floor is also what stops a runaway pinch gesture from
 * collapsing the crop to zero and dividing by it downstream.
 */
const MIN_CROP = 0.02;

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}

/**
 * Move a crop, stopping at the edges of the source.
 *
 * Clamped rather than rejected: a gesture that runs into an edge should slide
 * along it, not stop dead or snap back. Size is never touched, so panning
 * cannot change the zoom level — the two operations stay independent, which is
 * what lets a pinch and a drag run in the same gesture without fighting.
 */
export function panCrop(crop: Crop, delta: Point): Crop {
  return {
    x: clamp(crop.x + delta.x, 0, 1 - crop.w),
    y: clamp(crop.y + delta.y, 0, 1 - crop.h),
    w: crop.w,
    h: crop.h,
  };
}

/**
 * Scale a crop about a fixed point in source coordinates.
 *
 * `factor > 1` zooms **in**, which makes the crop rectangle *smaller*. That
 * inversion is the thing to keep straight: the crop is the viewport onto the
 * source, so a tighter viewport is a closer look.
 *
 * The anchor is what makes a pinch feel attached to the image — the source
 * point under the fingers must not move. It is honoured exactly until a clamp
 * intervenes at an edge, at which point staying inside the source wins; an
 * anchor that could not be respected is a worse outcome than a crop that
 * samples pixels which do not exist.
 */
export function zoomCrop(crop: Crop, factor: number, anchor: Point): Crop {
  // One scale applied to both axes at once, rather than clamping `w` and
  // deriving `h` from it (or vice versa). Deriving one axis from the other's
  // already-clamped value lets the derived axis blow *past* its own bound:
  // when a very wide crop (say h/w = 0.01) zooms in far enough that `w`
  // floors at MIN_CROP, `h` floors too, and `h`'s own required companion
  // `h / aspect` comes out above 1 — the crop then runs off the source's
  // right edge with an aspect ratio that still checks out. A uniform scale
  // keeps both axes in lockstep, so this cannot happen: whatever scale is
  // chosen applies identically to `w` and `h`, and the scale itself is
  // clamped, once, against both axes' bounds before either is computed.
  const scaleMin = Math.max(MIN_CROP / crop.w, MIN_CROP / crop.h);
  const scaleMax = Math.min(1 / crop.w, 1 / crop.h);
  // scaleMin can exceed scaleMax only when the crop's own aspect ratio is so
  // extreme that no single scale keeps both axes inside [MIN_CROP, 1] at
  // once — a fixed floor is not the same fraction of a wide axis and a
  // narrow one. Every aspect `defaultCropFor` can produce (0.75, 1, 1.33) is
  // nowhere near this, so it can only be reached via a hand-edited or
  // corrupted document. Staying inside the source wins in that case, for the
  // same reason the anchor gives way below: a crop that samples outside the
  // image is a worse outcome than one that is smaller than the usual floor.
  const scale =
    scaleMin > scaleMax ? scaleMax : clamp(1 / factor, scaleMin, scaleMax);

  const width = crop.w * scale;
  const h = crop.h * scale;

  // Keep the anchor's position within the crop constant, then clamp into range.
  const fractionX = crop.w === 0 ? 0.5 : (anchor.x - crop.x) / crop.w;
  const fractionY = crop.h === 0 ? 0.5 : (anchor.y - crop.y) / crop.h;

  return {
    x: clamp(anchor.x - fractionX * width, 0, Math.max(0, 1 - width)),
    y: clamp(anchor.y - fractionY * h, 0, Math.max(0, 1 - h)),
    w: width,
    h,
  };
}

/**
 * How far in a crop is zoomed, where 1 is the widest framing that still fills
 * the tile.
 *
 * Defined as `1 / max(w, h)` rather than by area or by either axis alone,
 * because `defaultCropFor` always pins the *longer* axis to the full extent of
 * the source (it returns either `w: 1` or `h: 1`), so an untouched crop reads
 * as exactly 1 whatever the tile's aspect. `zoomCrop` scales both axes by one
 * shared factor, so `max(w, h)` scales by that same factor — which makes this
 * an exact inverse of the zoom applied, not an approximation of it. That is
 * what lets a slider read a position off a crop and write one back without the
 * two drifting apart over a long drag.
 *
 * Total rather than throwing on a degenerate crop: this feeds a control's
 * *position*, and a document carrying a zero-area crop (nothing validates one
 * — see `migrate()`) should render a control pinned to its end stop rather
 * than take the surface down. The arithmetic that has to refuse such a crop —
 * `toTilePoint`, `imageDrawRect` — still does.
 */
export function zoomOf(crop: Crop): number {
  const extent = Math.max(crop.w, crop.h);
  if (!(extent > 0)) return 1 / MIN_CROP;
  return 1 / extent;
}

/**
 * The largest zoom `zoomCrop` will actually reach for this crop.
 *
 * Not a constant, because `MIN_CROP` is a floor on each *axis* and a crop's
 * two axes are not the same length: a 4:3 crop hits the floor on its short
 * axis while its long axis still has room. Deriving this from `zoomCrop`'s own
 * `scaleMin` is what keeps a zoom control's end stop at the place the zoom
 * actually stops, instead of leaving a stretch of travel that does nothing.
 *
 * Invariant under zooming: scaling a crop by `s` divides both `zoomOf` and
 * `scaleMin` by `s`, so the ratio is unchanged and a control's range does not
 * move under the user's finger mid-drag.
 */
export function maxZoomFor(crop: Crop): number {
  if (!(crop.w > 0) || !(crop.h > 0)) return zoomOf(crop);
  const scaleMin = Math.max(MIN_CROP / crop.w, MIN_CROP / crop.h);
  const scaleMax = Math.min(1 / crop.w, 1 / crop.h);
  // Mirrors `zoomCrop`'s own degenerate branch: where no single scale keeps
  // both axes in range, staying inside the source wins and the crop cannot
  // get any smaller than it already is.
  if (scaleMin > scaleMax) return zoomOf(crop);
  return zoomOf(crop) / scaleMin;
}

/** The middle of a crop, in source-normalized coordinates. */
export function cropCenter(crop: Crop): Point {
  return { x: crop.x + crop.w / 2, y: crop.y + crop.h / 2 };
}

/**
 * Zoom to an absolute level rather than by a relative factor.
 *
 * A slider knows where it wants to be, not how far that is from where it was,
 * and computing the factor at the call site would put this arithmetic in the
 * UI — where a stale read of the crop would make the two disagree silently.
 */
export function zoomCropTo(crop: Crop, zoom: number, anchor: Point): Crop {
  const current = zoomOf(crop);
  if (!(current > 0) || !(zoom > 0) || !Number.isFinite(zoom)) return crop;
  return zoomCrop(crop, zoom / current, anchor);
}

/**
 * Everything the crop machine needs about the tile being reframed, supplied
 * fresh on every event — the same contract as `EditContext`, and for the same
 * reason: the document can move under a gesture, and a machine holding its own
 * copy of the edit would commit a stale one over the top.
 */
export interface CropContext {
  itemId: string;
  /** The surface the crop is shown on, in the space pointers are reported in. */
  tile: Rect;
  /** The item's current edit — the base a gesture starts from. */
  edit: ImageEdit;
}

export type CropState =
  | { phase: "idle" }
  | {
      phase: "active";
      /**
       * The crop as this gesture has it so far. The document does not carry it
       * until the gesture ends, so the surface must render *this* rather than
       * `context.edit.crop` while a gesture is in flight.
       */
      crop: Crop;
      /** Where the pointer was last seen, or null when no pan is under way. */
      panFrom: Point | null;
    };

export type CropEvent =
  | { type: "panStart"; at: Point; context: CropContext }
  | { type: "panMove"; at: Point; context: CropContext }
  | { type: "panEnd"; at: Point; context: CropContext }
  /** A relative nudge — a wheel notch or a pinch — anchored under the pointer. */
  | { type: "zoomBy"; factor: number; at: Point; context: CropContext }
  /** An absolute level — a slider — anchored on the crop's own centre. */
  | { type: "zoomTo"; zoom: number; context: CropContext }
  /** The end of a run of zoom events. A wheel has no "up", so the caller says. */
  | { type: "zoomEnd"; context: CropContext }
  | { type: "cancel" };

export interface CropResult {
  state: CropState;
  /** Non-null exactly when the gesture committed something. */
  action: TierListAction | null;
}

export function idleCrop(): CropState {
  return { phase: "idle" };
}

/** The crop a gesture builds on: its own if one is in flight, else the document's. */
function working(state: CropState, context: CropContext): Crop {
  return state.phase === "active" ? state.crop : context.edit.crop;
}

/**
 * How close two crops have to be to count as the same one.
 *
 * Exact equality is wrong here, and not for a theoretical reason: zooming in
 * by 2 and back out by 0.5 is a division and a multiplication in normalized
 * space, and it lands on `0.09999999999999998` rather than `0.1`. Under exact
 * comparison a wheel run that ended where it began would commit an
 * `item/setEdit`, put an undo step on the stack that appears to do nothing,
 * and send a revision over the wire — which is exactly what emitting nothing
 * for an unmoved gesture exists to prevent.
 *
 * `1e-9` of a source's extent is under a thousandth of a pixel on a 100,000px
 * image, so nothing a user could express is lost inside it, while double
 * precision noise over a realistic run of operations stays several orders of
 * magnitude below it.
 */
const CROP_EPSILON = 1e-9;

function sameCrop(a: Crop, b: Crop): boolean {
  return (
    Math.abs(a.x - b.x) < CROP_EPSILON &&
    Math.abs(a.y - b.y) < CROP_EPSILON &&
    Math.abs(a.w - b.w) < CROP_EPSILON &&
    Math.abs(a.h - b.h) < CROP_EPSILON
  );
}

/**
 * The one action a whole gesture emits, or null when it moved nothing.
 *
 * Built from `context.edit` rather than from anything captured when the
 * gesture started, so an autosave or an undo landing mid-gesture is not
 * clobbered — only the crop this gesture actually changed is written.
 *
 * A gesture that ends where it started emits nothing at all. Without that, a
 * click on the crop surface would put an undo step on the stack that restores
 * the state the document is already in, and a revision on the wire for it.
 */
function commit(crop: Crop, context: CropContext): TierListAction | null {
  if (sameCrop(crop, context.edit.crop)) return null;
  return {
    type: "item/setEdit",
    itemId: context.itemId,
    edit: { ...context.edit, crop },
  };
}

/**
 * Drag a pointer across the tile and the crop follows it, in source units.
 *
 * Negated: dragging right moves the *picture* right, which means the window
 * onto the source moves *left*. The two axes scale by their own tile dimension
 * and their own crop extent — never by a shared one — because a tile and a
 * crop are both free to be non-square, and reusing one axis's divisor for the
 * other is exactly the transposition a square fixture cannot catch.
 */
function panDelta(from: Point, to: Point, tile: Rect, crop: Crop): Point {
  return {
    x: -((to.x - from.x) / tile.width) * crop.w,
    y: -((to.y - from.y) / tile.height) * crop.h,
  };
}

/**
 * The crop surface's gesture machine.
 *
 * One gesture emits at most one `item/setEdit`, at its end — the same contract
 * `editReduce` holds for the pen, and for the same reason: `mergeKeyFor`
 * deliberately leaves `item/setEdit` unkeyed, because the action replaces a
 * whole `ImageEdit` and cannot say which part of it moved. Coalescing
 * therefore has to happen here, where the gesture boundary is known.
 *
 * Pan and zoom share one working crop rather than running as two machines, so
 * a wheel notch in the middle of a drag refines the same gesture instead of
 * committing a second action and starting a third. Whichever of the two ends
 * last is the one that commits: a `zoomEnd` arriving while a pan is still down
 * defers, because the pan is going to commit the combined result anyway.
 *
 * Pure, and it never reads a clock. A wheel run has no natural end, so the
 * caller decides when one has finished and sends `zoomEnd` — exactly as
 * `useBoardGesture` owns the hold timer the pure drag machine will not.
 */
export function cropReduce(state: CropState, event: CropEvent): CropResult {
  switch (event.type) {
    case "cancel":
      return { state: idleCrop(), action: null };

    case "panStart":
      return {
        state: { phase: "active", crop: working(state, event.context), panFrom: event.at },
        action: null,
      };

    case "panMove": {
      // A move with no pan under way is not an error: a gesture can begin
      // outside the surface and wander in, and the pointer can also be moving
      // over the surface with no button held.
      if (state.phase !== "active" || !state.panFrom) return { state, action: null };
      const crop = panCrop(
        state.crop,
        panDelta(state.panFrom, event.at, event.context.tile, state.crop),
      );
      return { state: { phase: "active", crop, panFrom: event.at }, action: null };
    }

    case "panEnd": {
      if (state.phase !== "active" || !state.panFrom) return { state, action: null };
      // The last move is applied here rather than assumed to have arrived as
      // its own event: a pointer released after a move the browser coalesced
      // away would otherwise drop the final travel.
      const crop = panCrop(
        state.crop,
        panDelta(state.panFrom, event.at, event.context.tile, state.crop),
      );
      return { state: idleCrop(), action: commit(crop, event.context) };
    }

    case "zoomBy": {
      const base = working(state, event.context);
      // The anchor is the source point currently under the pointer, computed
      // against the *working* crop — the one on screen — so the pixel the user
      // is pointing at is the pixel that stays put.
      const anchor = toSourcePoint(event.at, event.context.tile, base);
      return {
        state: {
          phase: "active",
          crop: zoomCrop(base, event.factor, anchor),
          panFrom: state.phase === "active" ? state.panFrom : null,
        },
        action: null,
      };
    }

    case "zoomTo": {
      const base = working(state, event.context);
      return {
        state: {
          phase: "active",
          // Anchored on the crop's own centre: a slider has no position on the
          // image to zoom about, and centring is the only choice that does not
          // drift the framing sideways as the level changes.
          crop: zoomCropTo(base, event.zoom, cropCenter(base)),
          panFrom: state.phase === "active" ? state.panFrom : null,
        },
        action: null,
      };
    }

    case "zoomEnd": {
      if (state.phase !== "active") return { state, action: null };
      // A pan is still down and owns the commit for the combined gesture.
      if (state.panFrom) return { state, action: null };
      return { state: idleCrop(), action: commit(state.crop, event.context) };
    }
  }
}
