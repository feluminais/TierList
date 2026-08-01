import type { Item } from "@tl/core";

export const BOARD_BACKGROUND = "#14161a";
export const ROW_LABEL_TEXT = "#14161a";
export const TILE_TEXT = "#e6e8ec";

/** A text tile. */
export const TILE_TEXT_FILL = "#242830";
/** Drawn between tiles and rows so adjacent bands stay distinguishable. */
export const BOARD_LINE = "#0b0d10";

/** An image tile whose bytes are still arriving. */
export const TILE_LOADING = "#3a3f47";
/** An image tile whose bytes could not be fetched or decoded. */
export const TILE_FAILED = "#4a2f33";

/**
 * The bar showing where a dragged item would land. Deliberately not one of the
 * tile or row fills: it has to read as an annotation on the board rather than
 * as another tile, on top of whatever colour the user gave the tier under it.
 */
export const CARET = "#4ade80";
/** Border around the tile following the finger, so it reads as lifted. */
export const PREVIEW_BORDER = "#4ade80";

/**
 * The fill *behind* a tile.
 *
 * For a ready image this is what shows through where the image does not cover
 * — which the aspect lock means is nowhere, but a decoded image can still be
 * one pixel short of its declared size. For loading and failed tiles it is the
 * whole tile, and the two are deliberately different colours: "not here yet"
 * and "not coming" are different things to tell someone, and a single grey
 * swatch for both is how a broken upload gets mistaken for a slow one.
 */
export function tileFill(item: Item, status?: "loading" | "ready" | "failed"): string {
  if (item.kind !== "image") return TILE_TEXT_FILL;
  if (status === "failed") return TILE_FAILED;
  return TILE_LOADING;
}

/**
 * Text is clipped by character count rather than measured width.
 *
 * Skia can measure precisely, but measurement needs a loaded font, and the
 * font resolves asynchronously — so a width-based truncation would reflow the
 * first time it paints. A character budget derived from the tile width is
 * stable from the first frame and wrong only at the margin.
 */
export function truncate(label: string, tileWidth: number, fontSize: number): string {
  // 0.55em is a reasonable mean advance for Inter's lowercase range.
  const budget = Math.max(1, Math.floor(tileWidth / (fontSize * 0.55)));
  if (label.length <= budget) return label;
  return `${label.slice(0, Math.max(1, budget - 1))}…`;
}

/** Font size for a tile's label, scaled to the tile it must fit inside. */
export function tileFontSize(tileWidth: number): number {
  return Math.max(9, Math.min(16, Math.round(tileWidth / 7)));
}

/** Font size for a row's label. Larger — it is the tier name. */
export function rowFontSize(labelWidth: number, rowHeight: number): number {
  return Math.max(12, Math.min(40, Math.round(Math.min(labelWidth / 3, rowHeight / 2.5))));
}
