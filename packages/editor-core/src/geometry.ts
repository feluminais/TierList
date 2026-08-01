export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Half-open on the far edges: a point on the right or bottom edge belongs to
 * the *next* rectangle, not this one. Rows are stacked edge to edge, so a
 * closed test would let two rows both claim the boundary pixel and hit-testing
 * would depend on iteration order.
 */
export function contains(rect: Rect, point: Point): boolean {
  return (
    point.x >= rect.x &&
    point.x < rect.x + rect.width &&
    point.y >= rect.y &&
    point.y < rect.y + rect.height
  );
}
