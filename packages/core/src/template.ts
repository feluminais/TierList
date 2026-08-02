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
 * Drop the keys a derived document must not inherit.
 *
 * Deleted rather than set to `undefined`: a document is stored as JSON, where
 * `{templateId: undefined}` and `{}` round-trip to the same thing, so leaving
 * the key in place makes a derived document compare unequal to a reloaded copy
 * of itself.
 */
function without<T extends object, K extends keyof T>(value: T, ...keys: K[]): Omit<T, K> {
  const next = { ...value };
  for (const key of keys) delete next[key];
  return next;
}

/** Spreads to nothing when there is no author, for the same reason. */
function author(id: string | undefined): { authorId?: string } {
  return id === undefined ? {} : { authorId: id };
}

/**
 * Publish a tier list as a template: the same rows and items, every one of
 * them in the tray.
 *
 * Row and item ids are preserved because comparison matches on them. Every
 * item gets a tray placement rather than none, so a template is an ordinary
 * document that holds the placement invariant and can be opened in the editor
 * without repair.
 */
export function toTemplate(doc: TierList, params: DeriveParams): TierList {
  return {
    // A template has no template of its own, and `doc` may itself be a fill.
    ...without(doc, "templateId", "templateRevision"),
    id: params.id,
    schemaVersion: SCHEMA_VERSION,
    rows: doc.rows.map((r) => ({ ...r })),
    items: doc.items.map((i) => ({ ...i, edit: { ...i.edit, strokes: [...i.edit.strokes] } })),
    placements: trayPlacements(doc),
    boardAnnotations: [],
    ...author(params.authorId ?? doc.authorId),
    createdAt: params.now,
    updatedAt: params.now,
    revision: 0,
  };
}

/**
 * Begin filling in a template. Everything starts in the tray.
 *
 * `templateRevision` records the tier scale this fill was ranked against.
 * Both sides can change afterwards — a fill's rows are editable like any
 * other document's, and the template's own rows move independently — so the
 * scale cannot be reconstructed later and is stamped here instead.
 */
export function startFill(template: TierList, params: DeriveParams): TierList {
  return {
    ...without(template, "authorId"),
    id: params.id,
    schemaVersion: SCHEMA_VERSION,
    rows: template.rows.map((r) => ({ ...r })),
    items: template.items.map((i) => ({ ...i, edit: { ...i.edit, strokes: [...i.edit.strokes] } })),
    placements: trayPlacements(template),
    boardAnnotations: [],
    templateId: template.id,
    templateRevision: template.revision,
    ...author(params.authorId),
    createdAt: params.now,
    updatedAt: params.now,
    revision: 0,
  };
}
