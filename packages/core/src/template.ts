import { SCHEMA_VERSION, type Placement, type TierList } from "./types";

export interface DeriveParams {
  id: string;
  now: string;
  authorId?: string;
}

/**
 * Whether this document was started from another one.
 *
 * `templateId` is written only by `startFill` and no action can change it, so
 * its presence is the whole answer. A document that merely *looks* like a
 * template — everything in the tray — is not a fill; it is a list nobody has
 * started yet.
 */
export function isFill(doc: TierList): boolean {
  return doc.templateId !== undefined;
}

export interface FillProgress {
  /** Items sitting in a tier. */
  placed: number;
  /** Items in the document, wherever they sit. */
  total: number;
  /** `placed / total`, and 1 when there is nothing to place. */
  fraction: number;
}

/**
 * How far through a fill the user is.
 *
 * Counted from `items` rather than from `placements`, and by looking each
 * item's placement up: an item with no placement at all is unplaced, not
 * absent. Nothing in the reducer produces that, but `migrate()` performs no
 * structural validation, so a stored document can arrive holding one — and
 * counting placements instead would quietly report a total the board does not
 * show.
 *
 * A list with no items is complete rather than 0/0 of nothing: the readout
 * exists to say "anything left?", and dividing by zero to answer it would put
 * `NaN%` on the screen.
 */
export function fillProgress(doc: TierList): FillProgress {
  const location = new Map(doc.placements.map((p) => [p.itemId, p.rowId]));
  let placed = 0;
  for (const item of doc.items) {
    if ((location.get(item.id) ?? null) !== null) placed += 1;
  }
  const total = doc.items.length;
  return { placed, total, fraction: total === 0 ? 1 : placed / total };
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
