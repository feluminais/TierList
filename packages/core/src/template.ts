import { SCHEMA_VERSION, type Placement, type TierList } from "./types";

export interface DeriveParams {
  id: string;
  now: string;
  authorId?: string;
}

/**
 * Put every item in the tray, numbered `0..n-1` by the item's own `order`.
 *
 * The source document's placements cannot supply that order, even though some
 * of them are already tray placements: the items sitting in rows carry row
 * indices, which collide with the tray's and with each other once every item
 * is pooled into one location. `order` is the only ordering the source defines
 * across all items regardless of where each currently sits — and being the
 * item's own field, it does not depend on how a caller arranged the array.
 */
function trayPlacements(doc: TierList): Placement[] {
  return [...doc.items]
    .sort((a, b) => a.order - b.order)
    .map((item, index) => ({ itemId: item.id, rowId: null, index }));
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
