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
