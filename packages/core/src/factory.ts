import {
  SCHEMA_VERSION,
  type DisplaySettings,
  type ImageEdit,
  type Row,
  type TierList,
} from "./types";

/**
 * The tier colours, in the order they are handed out.
 *
 * One list, exported, because two surfaces mint tiers — the default five here,
 * and every tier a user adds afterwards — and a second copy is how a new tier
 * ends up a washed-out cousin of the ones above it. The first five are the
 * canonical S–D ramp; the rest continue it so an eighth tier still reads as
 * part of the same scale.
 *
 * Saturated on purpose: these sit behind bold labels on a near-black board,
 * where a pastel reads as grey.
 */
export const TIER_PALETTE: readonly string[] = [
  "#ff4d4d",
  "#ff9f2e",
  "#ffd633",
  "#7ed957",
  "#39b7ff",
  "#a06bff",
  "#ff5fc8",
  "#00d3b8",
];

const DEFAULT_ROWS: ReadonlyArray<{ label: string; color: string }> = [
  { label: "S", color: TIER_PALETTE[0]! },
  { label: "A", color: TIER_PALETTE[1]! },
  { label: "B", color: TIER_PALETTE[2]! },
  { label: "C", color: TIER_PALETTE[3]! },
  { label: "D", color: TIER_PALETTE[4]! },
];

export function defaultImageEdit(): ImageEdit {
  return {
    crop: { x: 0, y: 0, w: 1, h: 1 },
    rotation: 0,
    zoom: 1,
    offset: { x: 0, y: 0 },
    strokes: [],
  };
}

export function defaultDisplay(): DisplaySettings {
  return {
    tileSize: 96,
    tileAspect: "square",
    labelWidth: 120,
    density: "normal",
    showLabels: true,
  };
}

export interface CreateTierListParams {
  id: string;
  now: string;
  title?: string;
  authorId?: string;
}

export function createTierList(params: CreateTierListParams): TierList {
  const rows: Row[] = DEFAULT_ROWS.map((r, i) => ({
    id: `${params.id}-row-${i}`,
    label: r.label,
    color: r.color,
    order: i,
  }));

  return {
    id: params.id,
    schemaVersion: SCHEMA_VERSION,
    title: params.title ?? "Untitled tier list",
    description: "",
    categoryId: null,
    tags: [],
    rows,
    items: [],
    placements: [],
    display: defaultDisplay(),
    boardAnnotations: [],
    // Spread rather than assigned, so an absent author leaves no key behind.
    // A document is stored as JSON, where a key holding `undefined` and an
    // absent key round-trip to the same thing.
    ...(params.authorId === undefined ? {} : { authorId: params.authorId }),
    createdAt: params.now,
    updatedAt: params.now,
    revision: 0,
  };
}
