import type { ImageEdit } from "@tl/core";
import type { Rect } from "./geometry";

/** The intrinsic pixel size of an uploaded image. */
export interface SourceSize {
  width: number;
  height: number;
}

/** Which pixels of the source to sample, and where to paint them. */
export interface ImagePlacement {
  /** In source pixels. */
  source: Rect;
  /** In board coordinates — always the whole tile. */
  dest: Rect;
}

/**
 * The crop an image gets before anyone touches it: the largest centred
 * rectangle of the source that already has the tile's aspect ratio.
 *
 * Centred rather than top-left because a photograph's subject is far more
 * often in the middle than in a corner, and this is the framing the user sees
 * before they have expressed any preference at all.
 *
 * `tileAspect` is height ÷ width, matching `ASPECT_RATIO` in layout.ts — the
 * same convention, deliberately, so the two cannot drift into meaning
 * reciprocals of each other.
 */
export function defaultCropFor(
  source: SourceSize,
  tileAspect: number,
): ImageEdit["crop"] {
  const sourceAspect = source.height / source.width;

  // The source is taller than the tile wants, so height is the constrained
  // axis: keep full width and take a centred horizontal band.
  if (sourceAspect > tileAspect) {
    const h = tileAspect / sourceAspect;
    return { x: 0, y: (1 - h) / 2, w: 1, h };
  }

  // Wider than wanted (or equal): keep full height, take a centred column.
  const w = sourceAspect / tileAspect;
  return { x: (1 - w) / 2, y: 0, w, h: 1 };
}

/**
 * A floor on a sampling rectangle, in source pixels. A zero-width or
 * zero-height source rect is not a small draw — it is a division by zero in
 * every renderer that scales one rect onto another, and a document can reach
 * us with any crop at all because `migrate()` performs no structural
 * validation.
 */
const MIN_SOURCE_PX = 1;

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}

/**
 * Where a tile's image comes from and where it goes.
 *
 * `edit.zoom` and `edit.offset` are **deliberately not read**. An
 * aspect-locked crop rectangle already encodes both framing operations — its
 * size is the zoom and its position is the pan — so reading them as well would
 * be a second encoding of the same information, free to disagree with the rect
 * and with no rule saying which wins. They remain in the schema because
 * removing a field costs a migration and buys nothing.
 *
 * The destination is always the whole tile. That is what the aspect lock is
 * for: the crop is chosen to have the tile's shape, so it fills it exactly and
 * there is never a letterbox to decide the colour of.
 */
export function imagePlacement(
  source: SourceSize,
  edit: ImageEdit,
  tile: Rect,
): ImagePlacement {
  if (edit.rotation !== 0) {
    // Not silently ignored: rotation changes which source rectangle a tile
    // samples, and the aspect lock would then be a statement about the
    // rotated source rather than the original. Failing here is what stops a
    // future caller from setting it and getting a confidently wrong picture.
    throw new Error(
      `imagePlacement does not implement rotation (got ${edit.rotation})`,
    );
  }

  // Clamped rather than trusted: `migrate()` does not validate structure, so a
  // stored document can carry a crop that runs off the edge of its own image.
  const x = clamp(edit.crop.x, 0, 1) * source.width;
  const y = clamp(edit.crop.y, 0, 1) * source.height;
  const width = Math.max(
    MIN_SOURCE_PX,
    Math.min(clamp(edit.crop.w, 0, 1) * source.width, source.width - x),
  );
  const height = Math.max(
    MIN_SOURCE_PX,
    Math.min(clamp(edit.crop.h, 0, 1) * source.height, source.height - y),
  );

  return { source: { x, y, width, height }, dest: tile };
}
