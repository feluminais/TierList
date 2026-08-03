import {
  SCHEMA_VERSION,
  type DisplaySettings,
  type ImageEdit,
  type Row,
  type TierList,
} from "./types";

const DEFAULT_ROWS: ReadonlyArray<{ label: string; color: string }> = [
  { label: "S", color: "#ff4d4d" },
  { label: "A", color: "#ff9f2e" },
  { label: "B", color: "#ffd633" },
  { label: "C", color: "#7ed957" },
  { label: "D", color: "#39b7ff" },
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
