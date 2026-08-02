import type { ImageEdit, Stroke } from "@tl/core";
import type { Point, Rect } from "./geometry";

type Crop = ImageEdit["crop"];

/**
 * A board-space point, as the source image sees it.
 *
 * Strokes are stored against the **source image**, never the tile and never
 * the crop. A stroke drawn on someone's face has to stay on their face when
 * the crop changes, and normalizing to either of the others would slide every
 * annotation off its content the moment the framing moved. This is what
 * "non-destructive" has to mean in practice.
 *
 * Deliberately unclamped. A finger can leave the tile mid-stroke, which is not
 * an error; clamping would bunch points against the edge and turn a stroke
 * running off the picture into a smear along its border.
 *
 * A zero-width or zero-height tile divides by zero here, and a `NaN` written
 * into a stroke's points is silent corruption that survives `simplifyPoints`
 * and lands in the document. `layoutBoard` cannot produce such a tile, but
 * nothing stops a caller passing one, so this fails loudly instead.
 */
export function toSourcePoint(point: Point, tile: Rect, crop: Crop): Point {
  if (!(tile.width > 0) || !(tile.height > 0)) {
    throw new Error(
      `toSourcePoint requires a tile with positive width and height (got ${JSON.stringify(tile)})`,
    );
  }
  const withinTileX = (point.x - tile.x) / tile.width;
  const withinTileY = (point.y - tile.y) / tile.height;
  return {
    x: crop.x + withinTileX * crop.w,
    y: crop.y + withinTileY * crop.h,
  };
}

/**
 * The inverse of `toSourcePoint`: a stored stroke point, back in board space.
 *
 * Deliberately unclamped, for the mirror of `toSourcePoint`'s reason. A stroke
 * drawn before a tighter crop legitimately falls outside it, and clamping would
 * smear it along the tile's edge instead of letting the renderer clip it away.
 */
export function toTilePoint(point: Point, tile: Rect, crop: Crop): Point {
  if (crop.w <= 0 || crop.h <= 0) {
    throw new Error("toTilePoint: crop has zero area");
  }
  return {
    x: tile.x + ((point.x - crop.x) / crop.w) * tile.width,
    y: tile.y + ((point.y - crop.y) / crop.h) * tile.height,
  };
}

/**
 * The thinnest a stroke may be drawn, in destination pixels. A stroke thinner
 * than this is invisible, which reads as data loss rather than as a fine line.
 */
const MIN_STROKE_PX = 0.5;

/**
 * A stroke's stored width, in the pixels of the surface drawing it.
 *
 * `Stroke.width` is a fraction of the source image, exactly as `points` are,
 * so it converts with the same scale `toTilePoint` applies: the tile spans
 * `crop.w` of the source, so one unit of source width is `tile.width / crop.w`
 * pixels. Using this rather than the raw number is what keeps a stroke's
 * proportions identical on a board tile, on a magnified edit surface, and at
 * any crop zoom.
 */
export function strokeWidthInTile(width: number, tile: Rect, crop: Crop): number {
  if (!(crop.w > 0) || !(tile.width > 0) || !(width > 0)) return MIN_STROKE_PX;
  return Math.max(MIN_STROKE_PX, (width * tile.width) / crop.w);
}

/** Perpendicular distance from `p` to the line through `a` and `b`. */
function distanceToLine(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  // A zero-length segment is a point, not a line — a run of identical samples
  // reaches here, and the formula below would divide by zero.
  if (dx === 0 && dy === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  return Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / Math.hypot(dx, dy);
}

function pointAt(points: number[], index: number): Point {
  return { x: points[index * 2]!, y: points[index * 2 + 1]! };
}

/**
 * Ramer–Douglas–Peucker: drop every point that lies within `tolerance` of the
 * line between the points that would survive without it.
 *
 * A pen gesture emits one sample per frame — hundreds for a short scribble —
 * and every one is stored in the document, sent on every save and redrawn
 * every frame. Thinning is not an optimisation here; it is what keeps drawing
 * on a tile from making the document unusable.
 *
 * Iterative rather than recursive, because a recursive implementation
 * overflows the stack on a long run where every point matters.
 *
 * Cost grows sharply with the sample count in the worst case, which is
 * inherent to the algorithm. Callers cap the samples they feed in rather than
 * letting an unbounded gesture reach it.
 */
export function simplifyPoints(points: number[], tolerance: number): number[] {
  const count = Math.floor(points.length / 2);
  if (count < 3) return [...points];

  const keep = new Array<boolean>(count).fill(false);
  keep[0] = true;
  keep[count - 1] = true;

  const stack: [number, number][] = [[0, count - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    let worstIndex = -1;
    let worstDistance = tolerance;

    const a = pointAt(points, first);
    const b = pointAt(points, last);
    for (let i = first + 1; i < last; i++) {
      const distance = distanceToLine(pointAt(points, i), a, b);
      if (distance > worstDistance) {
        worstDistance = distance;
        worstIndex = i;
      }
    }

    if (worstIndex !== -1) {
      keep[worstIndex] = true;
      stack.push([first, worstIndex], [worstIndex, last]);
    }
  }

  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    if (keep[i]) out.push(points[i * 2]!, points[i * 2 + 1]!);
  }
  return out;
}

/**
 * A finished stroke.
 *
 * The id is passed in rather than generated, for the same reason the reducer
 * never generates one: it keeps this module pure and every test mock-free.
 */
export function strokeFromPoints(
  id: string,
  points: number[],
  color: string,
  width: number,
  tolerance: number,
): Stroke {
  return { id, points: simplifyPoints(points, tolerance), color, width };
}
