import type { DragState } from "./drag";
import type { Point } from "./geometry";

/** How near an edge the pointer must come before the board starts moving. */
export const AUTOSCROLL_EDGE_PX = 72;

/** Ceiling on one frame's scroll, so a finger parked at the edge glides. */
export const AUTOSCROLL_MAX_PX_PER_FRAME = 14;

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

/**
 * How far the board should scroll this frame while a drag is under way, given
 * where the finger is **within the viewport** — not within the content. The
 * caller converts, because only it knows the scroll offset.
 *
 * Negative scrolls up, positive down, 0 leaves it alone. The ramp is linear in
 * depth past the edge rather than a switch: a constant velocity makes a board
 * jump the moment a finger crosses the threshold, and the threshold is exactly
 * where a user is trying to place something precisely.
 *
 * Clamping to the content's real bounds is the scroller's job, not this one's.
 */
export function autoScrollDelta(
  pointerViewportY: number,
  viewportHeight: number,
): number {
  if (viewportHeight <= 0) return 0;

  // Never let the two zones meet. On a viewport shorter than two edge bands
  // they would overlap in the middle, and a pointer there would be "near" both
  // edges at once — scrolling up and down on alternate frames.
  const edge = Math.min(AUTOSCROLL_EDGE_PX, viewportHeight / 3);

  if (pointerViewportY < edge) {
    return -Math.round(clamp01((edge - pointerViewportY) / edge) * AUTOSCROLL_MAX_PX_PER_FRAME);
  }

  const fromBottom = viewportHeight - pointerViewportY;
  if (fromBottom < edge) {
    return Math.round(clamp01((edge - fromBottom) / edge) * AUTOSCROLL_MAX_PX_PER_FRAME);
  }

  return 0;
}

/**
 * Where the pointer now is **in content coordinates** after the board has
 * scrolled beneath a finger that did not move, or null when there is nothing
 * to correct.
 *
 * `DragState.pointer` is in content coordinates, and a stationary finger
 * produces no touch events — so while autoscroll runs, nothing updates it. The
 * caret and the preview would stay pinned to a content position the board has
 * since slid out from under, drifting further for as long as the autoscroll
 * lasts and snapping back only on the next real move. Feeding this point back
 * in as a synthetic `move` is what keeps them under the finger, and re-targets
 * the drop against the rows that have scrolled into view.
 *
 * The finger has not moved in *viewport* terms, so the content point beneath it
 * moves by exactly as far as the content did.
 *
 * That distance must be the **observed** change in the scroll offset and never
 * the delta that was requested: `autoScrollDelta` deliberately does not clamp to
 * the content bounds, so at the end of a list the scroller applies a requested
 * delta as zero. Adding the request here would walk the preview off the end of
 * the board while the board itself stood still.
 *
 * Because the correction is exactly the observed movement, the viewport
 * position it implies — `pointer.y - scrollY` — is unchanged by it. That is what
 * stops the autoscroll loop it feeds from running away: the next frame reads the
 * same viewport position and asks for the same delta, so the board glides at a
 * constant speed instead of accelerating.
 */
export function pointerAfterScroll(
  state: DragState,
  previousScrollY: number,
  scrollY: number,
): Point | null {
  if (state.phase !== "dragging") return null;

  const moved = scrollY - previousScrollY;

  // `moved === 0` is the ordinary case at the end of a list, and returning null
  // rather than an equal point lets the caller skip the event entirely. The
  // finiteness guard is not decoration: `pointer` accumulates, so one NaN offset
  // would poison it for the rest of the gesture and every subsequent drop target
  // would silently be null.
  if (!Number.isFinite(moved) || moved === 0) return null;

  return { x: state.pointer.x, y: state.pointer.y + moved };
}
