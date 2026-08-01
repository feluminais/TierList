import type { Item } from "@tl/core";

export const BOARD_BACKGROUND = "#14161a";
export const ROW_LABEL_TEXT = "#14161a";
export const TILE_TEXT = "#e6e8ec";

/** A tile whose image has not been uploaded yet. */
export const TILE_PENDING = "#3a3f47";
/** A text tile. */
export const TILE_TEXT_FILL = "#242830";
/** Drawn between tiles and rows so adjacent bands stay distinguishable. */
export const BOARD_LINE = "#0b0d10";

/**
 * The bar showing where a dragged item would land. Deliberately not one of the
 * tile or row fills: it has to read as an annotation on the board rather than
 * as another tile, on top of whatever colour the user gave the tier under it.
 */
export const CARET = "#4ade80";
/** Border around the tile following the finger, so it reads as lifted. */
export const PREVIEW_BORDER = "#4ade80";

/**
 * Image tiles render as a pending swatch until Milestone 3 builds the image
 * pipeline. Object storage is deferred, so an `assetId` currently names
 * nothing that can be fetched — a visible placeholder is honest, whereas an
 * empty tile reads as a rendering bug.
 */
export function tileFill(item: Item): string {
  return item.kind === "image" ? TILE_PENDING : TILE_TEXT_FILL;
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
