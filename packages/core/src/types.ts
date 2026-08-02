/**
 * The document schema this package reads and writes.
 *
 * 2 — the tray is an ordered location, so every location's placement indices
 *     are contiguous.
 * 3 — `Stroke.width` is a fraction of the source image's width rather than a
 *     pixel count, so a stroke keeps its proportions at any tile size.
 */
export const SCHEMA_VERSION = 3;

export type TileAspect = "square" | "portrait" | "landscape";
export type Density = "compact" | "normal" | "roomy";
export type ItemKind = "image" | "text";

/**
 * A freehand stroke.
 *
 * Both the geometry and the thickness are stored against the source image, not
 * against any surface that draws it: `points` are normalized 0..1 of the
 * source, and `width` is a fraction of the source's width. A renderer converts
 * both with the same scale, so a stroke keeps its proportions on a small board
 * tile, on a magnified edit surface, and at any crop zoom.
 */
export interface Stroke {
  id: string;
  points: number[]; // flat [x0, y0, x1, y1, ...]
  color: string;
  /** Fraction of the source image's width. See `strokeWidthInTile`. */
  width: number;
}

/**
 * The thickness a freshly drawn stroke is given, as a fraction of the source
 * width. Reads as a fine pen on a board tile and scales up on a magnified edit
 * surface.
 */
export const DEFAULT_STROKE_WIDTH = 0.02;

/** Non-destructive edits applied to an item's source image. */
export interface ImageEdit {
  crop: { x: number; y: number; w: number; h: number }; // normalized 0..1
  rotation: number; // degrees, clockwise
  zoom: number; // 1 = fit
  offset: { x: number; y: number }; // normalized pan within the tile
  strokes: Stroke[];
}

export interface Row {
  id: string;
  label: string;
  color: string;
  order: number;
  /** Overrides DisplaySettings.tileSize for this row only. */
  tileSizeOverride?: number;
}

export interface Item {
  id: string;
  kind: ItemKind;
  label?: string;
  assetId?: string; // present when kind === "image"
  edit: ImageEdit;
  order: number;
}

/**
 * Where an item sits. `rowId` null means the tray, unranked — but the tray is
 * an ordered location like any row, not a bag.
 *
 * Invariant: within each location — every row, and the tray — the `index`
 * values are contiguous `0..n-1`, with no holes and no duplicates, and one
 * item has at most one placement. Consumers may therefore read `index` as a
 * position and lay a location out by it directly, not merely sort by it.
 *
 * `reduce()` maintains the invariant but never checks it: this package is a
 * pure model, and checking untrusted input is a boundary concern. That
 * boundary is `validateDocument()`, which every write route runs.
 */
export interface Placement {
  itemId: string;
  rowId: string | null;
  index: number;
}

export interface DisplaySettings {
  tileSize: number; // px at 1x
  tileAspect: TileAspect;
  /** Width of a row's label column, in px. Set it to 0 to collapse it. */
  labelWidth: number;
  density: Density;
  /**
   * Whether an item's own label is drawn on its tile.
   *
   * Not about the row label column, which `labelWidth: 0` collapses. The label
   * is drawn on the tile rather than beneath it, so this changes no geometry:
   * `layoutBoard` ignores it and only the renderer reads it.
   */
  showLabels: boolean;
}

export interface TierList {
  id: string;
  schemaVersion: number;
  title: string;
  description: string;
  categoryId: string | null;
  tags: string[];
  rows: Row[];
  items: Item[];
  placements: Placement[];
  display: DisplaySettings;
  boardAnnotations: Stroke[];
  templateId?: string;
  /**
   * The template's `revision` when this fill was started, recording the tier
   * scale it was ranked against. Both sides can change afterwards, so the scale
   * cannot be reconstructed later. Compare surfaces a difference between two
   * fills' values rather than averaging over it.
   */
  templateRevision?: number;
  authorId?: string;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
  revision: number;
}
