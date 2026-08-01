import { SCHEMA_VERSION, type Placement, type TierList } from "./types";

export interface DeriveParams {
  id: string;
  now: string;
  authorId?: string;
}

function trayPlacements(doc: TierList): Placement[] {
  return doc.items.map((i) => ({ itemId: i.id, rowId: null, index: 0 }));
}

/**
 * Publish a tier list as a template: same rows, same items, no placements.
 * Row and item ids are preserved deliberately — comparison matches on them.
 */
export function toTemplate(doc: TierList, params: DeriveParams): TierList {
  return {
    ...doc,
    id: params.id,
    schemaVersion: SCHEMA_VERSION,
    rows: doc.rows.map((r) => ({ ...r })),
    items: doc.items.map((i) => ({ ...i, edit: { ...i.edit, strokes: [...i.edit.strokes] } })),
    placements: trayPlacements(doc),
    boardAnnotations: [],
    templateId: undefined,
    // Cleared explicitly: `doc` may itself be a fill, and spreading it would
    // carry its templateRevision onto a template that has no templateId.
    templateRevision: undefined,
    authorId: params.authorId ?? doc.authorId,
    createdAt: params.now,
    updatedAt: params.now,
    revision: 0,
  };
}

/** Begin filling in a template. Everything starts in the tray. */
export function startFill(template: TierList, params: DeriveParams): TierList {
  return {
    ...template,
    id: params.id,
    schemaVersion: SCHEMA_VERSION,
    rows: template.rows.map((r) => ({ ...r })),
    items: template.items.map((i) => ({ ...i, edit: { ...i.edit, strokes: [...i.edit.strokes] } })),
    placements: trayPlacements(template),
    boardAnnotations: [],
    templateId: template.id,
    templateRevision: template.revision,
    authorId: params.authorId,
    createdAt: params.now,
    updatedAt: params.now,
    revision: 0,
  };
}
