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
  // A zero or non-finite dimension, or a non-finite `tileAspect`, drives
  // `sourceAspect` to `NaN`, which survives every comparison below (all false
  // against `NaN`) and comes out as a crop with `NaN` fields. A source size
  // arrives from a decoded image rather than from the validated document, so
  // failing loudly here is what stops a `NaN` crop being written and silently
  // breaking every placement computed from it afterwards.
  if (
    !(source.width > 0) ||
    !(source.height > 0) ||
    !(tileAspect > 0) ||
    !Number.isFinite(tileAspect)
  ) {
    throw new Error(
      `defaultCropFor requires a positive, finite source size and tileAspect ` +
        `(got source=${JSON.stringify(source)}, tileAspect=${tileAspect})`,
    );
  }

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
 * every renderer that scales one rect onto another.
 */
const MIN_SOURCE_PX = 1;

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}

/**
 * Where a tile's image comes from and where it goes.
 *
 * `edit.zoom` and `edit.offset` are **not read**. An aspect-locked crop
 * rectangle already encodes both framing operations — its size is the zoom and
 * its position is the pan — so reading them as well would be a second encoding
 * of the same information, free to disagree with the rect and with no rule
 * saying which wins. They stay in the schema because removing a field costs a
 * migration and buys nothing.
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

  // Clamped rather than trusted: a crop is a fraction of the source, and the
  // source is whatever image decoded, so a valid crop can still run off the
  // edge of a smaller-than-expected image.
  //
  // `x`/`y` are pulled back from the far edge by `MIN_SOURCE_PX` rather than
  // clamped to `[0, source.width]`. A crop at `x: 1` clamps to exactly
  // `source.width`, leaving no room before the edge, and the floor below would
  // then push `width` to 1 with nowhere to put it — sampling one pixel past
  // the right edge. Reserving the floor's width when placing `x` keeps every
  // placement entirely inside the source, which is what the floor is for.
  const rawX = clamp(edit.crop.x, 0, 1) * source.width;
  const rawY = clamp(edit.crop.y, 0, 1) * source.height;
  const x = Math.min(rawX, Math.max(0, source.width - MIN_SOURCE_PX));
  const y = Math.min(rawY, Math.max(0, source.height - MIN_SOURCE_PX));
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

/**
 * Where to draw the **whole** image so that its crop covers the tile.
 *
 * Skia's Image node draws an entire image into a destination rect; it has no
 * source-rect parameter. Showing a crop therefore means drawing the whole
 * image scaled up and shifted so the wanted region covers the tile, and letting
 * the tile's clip discard the rest. This function is that shift.
 *
 * The two axes scale by **one shared factor** — the larger of the two ratios
 * needed to cover the tile — never by independent `scaleX`/`scaleY` values.
 * Independent scaling stretches the image whenever the crop's aspect ratio
 * does not exactly match the tile's, and that mismatch is reachable even
 * though a crop is aspect-locked when the image is added: `display.tileAspect`
 * is a setting the user can change afterwards.
 *
 * A single scale means a mismatched crop is *cropped further* by the tile's
 * clip instead of distorted. The image's own aspect ratio is preserved and the
 * tile is always fully covered, never letterboxed — the board has no sensible
 * letterbox colour.
 */
export function imageDrawRect(
  placement: ImagePlacement,
  size: SourceSize,
): Rect {
  const { source, dest } = placement;
  if (source.width <= 0 || source.height <= 0) {
    throw new Error("imageDrawRect: source rect has zero area");
  }

  // The larger ratio is what "cover" means: scaling by the smaller one would
  // leave the other axis short of the tile.
  const scale = Math.max(dest.width / source.width, dest.height / source.height);

  // Centred on the tile. Both offsets are zero when the crop's aspect already
  // matches the tile's, so in that case the drawn rect's corners land exactly
  // on the tile's corners.
  const offsetX = (dest.width - source.width * scale) / 2;
  const offsetY = (dest.height - source.height * scale) / 2;

  return {
    x: dest.x + offsetX - source.x * scale,
    y: dest.y + offsetY - source.y * scale,
    width: size.width * scale,
    height: size.height * scale,
  };
}
