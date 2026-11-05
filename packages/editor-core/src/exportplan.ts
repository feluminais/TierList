import type { TierList } from "@tl/core";
import { gapFor, layoutBoard, type BoardLayout } from "./layout";

/**
 * What an exported picture is allowed to be.
 *
 * Export geometry is a render parameter, never a property of the document:
 * writing it into `display` would make exporting an undoable edit and a
 * revision on the wire. Every setting is clamped here, so a dialog can pass
 * whatever a text box produced.
 */
export const EXPORT_LIMITS = {
  minWidth: 240,
  maxWidth: 4096,
  minColumns: 1,
  maxColumns: 40,
  minScale: 0.5,
  maxScale: 4,
  /**
   * The most pixels a picture may have. A canvas surface that size is already
   * well over a hundred megabytes, and browsers refuse far less than a
   * dimension limit would suggest.
   */
  maxPixels: 36_000_000,
} as const;

export interface ExportSettings {
  /**
   * The picture's width in layout units (before `scale`), or null to work it
   * out from `columns`. When both are given, `columns` wins.
   */
  width: number | null;
  /**
   * Tiles on a line at the list's own tile size, or null to use `width`. A tier
   * with a smaller tile size of its own fits more.
   */
  columns: number | null;
  /** Output pixels per layout unit. */
  scale: number;
  /** Whether the tray, with the items not yet placed, is part of the picture. */
  includeTray: boolean;
}

export const DEFAULT_EXPORT_SETTINGS: ExportSettings = {
  width: 1200,
  columns: null,
  scale: 1,
  includeTray: true,
};

export interface ExportPlan {
  /** The layout to draw, computed by `layoutBoard` and nothing else. */
  layout: BoardLayout;
  /** Width and height in layout units. */
  width: number;
  height: number;
  /** The scale actually used, which is lower than asked when the picture would be too large. */
  scale: number;
  scaleReduced: boolean;
  pixelWidth: number;
  pixelHeight: number;
  /** Tiles on a line at the list's own tile size, for showing back to the person. */
  columns: number;
}

function clampNumber(value: number | null, min: number, max: number, fallback: number | null, whole: boolean): number | null {
  if (value === null) return null;
  if (!Number.isFinite(value)) return fallback;
  const rounded = whole ? Math.round(value) : value;
  return Math.min(Math.max(rounded, min), max);
}

/** Every setting inside its range. A number that is not one becomes the default. */
export function clampExportSettings(settings: ExportSettings): ExportSettings {
  return {
    width: clampNumber(settings.width, EXPORT_LIMITS.minWidth, EXPORT_LIMITS.maxWidth, DEFAULT_EXPORT_SETTINGS.width, true),
    columns: clampNumber(settings.columns, EXPORT_LIMITS.minColumns, EXPORT_LIMITS.maxColumns, null, true),
    scale: clampNumber(settings.scale, EXPORT_LIMITS.minScale, EXPORT_LIMITS.maxScale, DEFAULT_EXPORT_SETTINGS.scale, false) ?? 1,
    includeTray: settings.includeTray,
  };
}

/**
 * The width at which `columns` tiles of the list's own size sit on one line:
 * the label column, the tiles and the gap before and between them.
 */
function widthForColumns(doc: TierList, columns: number): number {
  const gap = gapFor(doc.display.density);
  return doc.display.labelWidth + columns * (doc.display.tileSize + gap) + gap;
}

/**
 * Everything needed to draw an export, decided without a canvas.
 *
 * The geometry is `layoutBoard` at the export width, the one function the
 * editor, hit testing and drag targeting also read, so an export cannot
 * disagree with the board about where a tile is. Rendering it is somebody
 * else's job; this only says how big, how sharp and what is in it.
 *
 * When the requested scale would make the picture larger than a surface can
 * be, the scale is lowered and `scaleReduced` says so. The layout is never
 * changed to make room: a picture that is sharper than asked for would be
 * wrong, but one that is arranged differently would be a different picture.
 */
export function exportPlan(doc: TierList, requested: ExportSettings): ExportPlan {
  const s = clampExportSettings(requested);

  const width =
    s.columns !== null
      ? Math.min(widthForColumns(doc, s.columns), EXPORT_LIMITS.maxWidth)
      : (s.width ?? DEFAULT_EXPORT_SETTINGS.width ?? 1200);

  const layout = layoutBoard(doc, { width, includeTray: s.includeTray });
  const height = layout.contentHeight;

  // Largest scale at or below the request whose picture fits the pixel budget.
  const budgetScale = Math.sqrt(EXPORT_LIMITS.maxPixels / (width * Math.max(1, height)));
  let scale = Math.min(s.scale, budgetScale);
  let pixelWidth = Math.ceil(width * scale);
  let pixelHeight = Math.ceil(height * scale);
  // Rounding up can push a picture that just fit over the budget.
  while (pixelWidth * pixelHeight > EXPORT_LIMITS.maxPixels && scale > 0) {
    scale *= 0.99;
    pixelWidth = Math.ceil(width * scale);
    pixelHeight = Math.ceil(height * scale);
  }

  const scaleReduced = scale < s.scale;
  const gap = gapFor(doc.display.density);
  const labelWidth = Math.max(0, Math.min(doc.display.labelWidth, width - 40));
  const columns = Math.max(1, Math.floor((width - labelWidth - gap) / (doc.display.tileSize + gap)));

  return { layout, width, height, scale, scaleReduced, pixelWidth, pixelHeight, columns };
}
