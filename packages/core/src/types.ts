/**
 * 2 — the tray became an ordered location. Schema 1 wrote every tray placement
 * at `index: 0`, so the tray had no order to preserve.
 */
export const SCHEMA_VERSION = 2;

export type TileAspect = "square" | "portrait" | "landscape";
export type Density = "compact" | "normal" | "roomy";
export type ItemKind = "image" | "text";

/** A freehand stroke. Points are normalized 0..1 relative to their surface. */
export interface Stroke {
  id: string;
  points: number[]; // flat [x0, y0, x1, y1, ...]
  color: string;
  width: number;
}

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
 * values are contiguous `0..n-1`, with no holes and no duplicates. Consumers
 * may therefore read `index` as a position and lay a location out by it
 * directly, not merely sort by it.
 *
 * `reduce()` maintains that invariant but never checks it: @tl/core is a pure
 * model, and validating an untrusted document is a boundary concern. Its home
 * is `migrate()`, which `services/api` already treats as the sole authority on
 * what a valid document is. Until that validation exists, a document that
 * arrives holed stays holed — the reducer trusts its input.
 */
export interface Placement {
  itemId: string;
  rowId: string | null;
  index: number;
}

export interface DisplaySettings {
  tileSize: number; // px at 1x
  tileAspect: TileAspect;
  labelWidth: number; // px
  density: Density;
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
   * The template's `revision` at the moment this fill was started. Records the
   * tier scale the fill was ranked against, which cannot be reconstructed later
   * because both the fill's rows and the template's rows can change afterwards.
   * Compare must treat differing values as a condition to surface, not average over.
   */
  templateRevision?: number;
  authorId?: string;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
  revision: number;
}
