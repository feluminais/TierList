export const SCHEMA_VERSION = 1;

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

/** rowId null means the item is still in the tray, unranked. */
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
  authorId?: string;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
  revision: number;
}
