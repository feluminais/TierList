import type { ImageEdit } from "@tl/core";
import type { Point } from "./geometry";

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
  const aspect = crop.h / crop.w;

  // Both axes scale by the same amount, so the aspect lock survives by
  // construction rather than by being re-imposed afterwards.
  const w = clamp(crop.w / factor, MIN_CROP, 1);
  // Derived from w rather than scaled independently: floating-point drift
  // between two separate divisions is exactly how an aspect lock rots.
  const h = clamp(w * aspect, MIN_CROP, 1);
  // If h hit a bound, w has to follow or the ratio breaks.
  const width = h === w * aspect ? w : h / aspect;

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
