import { MAX_TAG_LENGTH, MAX_TAGS } from "./categories";
import type { TierList } from "./types";

/**
 * Upper bounds on what a stored document may hold.
 *
 * Each sits far above anything the editor produces. They exist so that one
 * hand-written document cannot make every reader of it — the share page, the
 * editor, everyone filling a template — allocate, lay out or download
 * something unbounded.
 */
export const DOCUMENT_LIMITS = {
  idLength: 128,
  titleLength: 200,
  descriptionLength: 2000,
  rowLabelLength: 100,
  itemLabelLength: 300,
  rows: 64,
  items: 2000,
  strokesPerSurface: 1000,
  /** Numbers, not points: a stroke is a flat `[x0, y0, x1, y1, …]` list. */
  strokeCoordinates: 8192,
  tileSize: 1024,
  labelWidth: 2048,
} as const;

/**
 * A CSS hex colour: `#rgb`, `#rrggbb` or `#rrggbbaa`.
 *
 * Colours reach inline styles on public, server-rendered pages. Fixing the
 * format here, once, means no renderer has to escape one: a value that matches
 * cannot end a declaration or start a function call.
 */
const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/**
 * The shape of a category id — not its membership in today's taxonomy.
 *
 * Every save re-validates the whole document, so checking membership would
 * make each list filed under a category that is later retired impossible to
 * save. Browse already treats an id it does not know as an empty category.
 */
const CATEGORY_ID = /^[a-z0-9-]{1,32}$/;

/**
 * Raised for a document that is structurally unusable. `problems` names every
 * fault found rather than only the first, so one round trip tells a caller
 * everything it has to fix.
 */
export class DocumentInvalidError extends Error {
  constructor(readonly problems: string[]) {
    super(`Document is not valid: ${problems.join("; ")}`);
    this.name = "DocumentInvalidError";
  }
}

const ITEM_KINDS = new Set(["image", "text"]);
const TILE_ASPECTS = new Set(["square", "portrait", "landscape"]);
const DENSITIES = new Set(["compact", "normal", "roomy"]);

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isFinite_ = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

const isIndex = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= 0;

const isTimestamp = (v: unknown): boolean =>
  typeof v === "string" && Number.isFinite(Date.parse(v));

/** True only for a string over the limit; a wrong type is reported elsewhere. */
const tooLong = (v: unknown, max: number): boolean =>
  typeof v === "string" && v.length > max;

/**
 * Check a document against the model's structural rules, collecting every
 * fault it finds.
 *
 * This is the boundary between untrusted input and everything downstream.
 * `reduce()` trusts its input and computes no defences of its own, the
 * renderers read positions straight out of the document, and the API projects
 * several fields into typed database columns — all of which are sound only for
 * a document that has been through here.
 *
 * Separate from `migrate()`, which converts between schema versions and is
 * deliberately tolerant of fields it cannot make sense of. Run migrate first,
 * then this.
 */
export function validateDocument(raw: unknown): string[] {
  const problems: string[] = [];
  const fail = (message: string) => problems.push(message);

  if (!isRecord(raw)) return ["document is not an object"];
  const doc = raw;

  const str = (key: string) => {
    if (typeof doc[key] !== "string") fail(`${key} must be a string`);
  };
  str("id");
  str("title");
  str("description");
  if (tooLong(doc["id"], DOCUMENT_LIMITS.idLength)) fail("id is too long");
  if (tooLong(doc["title"], DOCUMENT_LIMITS.titleLength)) fail("title is too long");
  if (tooLong(doc["description"], DOCUMENT_LIMITS.descriptionLength)) {
    fail("description is too long");
  }

  const categoryId = doc["categoryId"];
  if (categoryId !== null && typeof categoryId !== "string") {
    fail("categoryId must be a string or null");
  } else if (typeof categoryId === "string" && !CATEGORY_ID.test(categoryId)) {
    fail("categoryId is not a category id");
  }
  const tags = doc["tags"];
  if (!Array.isArray(tags) || tags.some((t) => typeof t !== "string")) {
    fail("tags must be an array of strings");
  } else if (tags.length > MAX_TAGS || tags.some((t) => tooLong(t, MAX_TAG_LENGTH))) {
    fail(`tags must be at most ${MAX_TAGS}, each at most ${MAX_TAG_LENGTH} characters`);
  }
  if (!isIndex(doc["revision"])) fail("revision must be a non-negative integer");
  if (!isTimestamp(doc["createdAt"])) fail("createdAt must be a timestamp");
  if (!isTimestamp(doc["updatedAt"])) fail("updatedAt must be a timestamp");

  for (const key of ["templateId", "authorId"] as const) {
    const value = doc[key];
    if (value !== undefined && typeof value !== "string") {
      fail(`${key} must be a string when present`);
    }
  }
  if (doc["templateRevision"] !== undefined && !isIndex(doc["templateRevision"])) {
    fail("templateRevision must be a non-negative integer when present");
  }

  const rowIds = new Set<string>();
  if (!Array.isArray(doc["rows"])) {
    fail("rows must be an array");
  } else if (doc["rows"].length > DOCUMENT_LIMITS.rows) {
    fail(`rows must number at most ${DOCUMENT_LIMITS.rows}`);
  } else {
    doc["rows"].forEach((value, at) => {
      const row = isRecord(value) ? value : null;
      if (!row) return fail(`rows[${at}] is not an object`);
      if (typeof row["id"] !== "string") return fail(`rows[${at}].id must be a string`);
      if (tooLong(row["id"], DOCUMENT_LIMITS.idLength)) fail(`rows[${at}].id is too long`);
      if (rowIds.has(row["id"])) fail(`rows[${at}].id is a duplicate`);
      rowIds.add(row["id"]);
      if (typeof row["label"] !== "string") fail(`rows[${at}].label must be a string`);
      if (tooLong(row["label"], DOCUMENT_LIMITS.rowLabelLength)) {
        fail(`rows[${at}].label is too long`);
      }
      if (typeof row["color"] !== "string") {
        fail(`rows[${at}].color must be a string`);
      } else if (!HEX_COLOR.test(row["color"])) {
        fail(`rows[${at}].color must be a hex colour`);
      }
      if (!isFinite_(row["order"])) fail(`rows[${at}].order must be a number`);
      const override = row["tileSizeOverride"];
      if (
        override !== undefined &&
        !(isFinite_(override) && override > 0 && override <= DOCUMENT_LIMITS.tileSize)
      ) {
        fail(
          `rows[${at}].tileSizeOverride must be a positive number up to ${DOCUMENT_LIMITS.tileSize} when present`,
        );
      }
      const bold = row["bold"];
      if (bold !== undefined && typeof bold !== "boolean") {
        fail(`rows[${at}].bold must be a boolean when present`);
      }
    });
  }

  const itemIds = new Set<string>();
  if (!Array.isArray(doc["items"])) {
    fail("items must be an array");
  } else if (doc["items"].length > DOCUMENT_LIMITS.items) {
    fail(`items must number at most ${DOCUMENT_LIMITS.items}`);
  } else {
    doc["items"].forEach((value, at) => {
      const item = isRecord(value) ? value : null;
      if (!item) return fail(`items[${at}] is not an object`);
      if (typeof item["id"] !== "string") return fail(`items[${at}].id must be a string`);
      if (tooLong(item["id"], DOCUMENT_LIMITS.idLength)) fail(`items[${at}].id is too long`);
      if (itemIds.has(item["id"])) fail(`items[${at}].id is a duplicate`);
      itemIds.add(item["id"]);
      if (typeof item["kind"] !== "string" || !ITEM_KINDS.has(item["kind"])) {
        fail(`items[${at}].kind must be "image" or "text"`);
      }
      if (item["label"] !== undefined && typeof item["label"] !== "string") {
        fail(`items[${at}].label must be a string when present`);
      }
      if (tooLong(item["label"], DOCUMENT_LIMITS.itemLabelLength)) {
        fail(`items[${at}].label is too long`);
      }
      if (item["kind"] === "image" && typeof item["assetId"] !== "string") {
        fail(`items[${at}].assetId is required for an image item`);
      }
      if (tooLong(item["assetId"], DOCUMENT_LIMITS.idLength)) {
        fail(`items[${at}].assetId is too long`);
      }
      if (!isFinite_(item["order"])) fail(`items[${at}].order must be a number`);
      checkEdit(item["edit"], `items[${at}].edit`, fail);
    });
  }

  checkStrokes(doc["boardAnnotations"], "boardAnnotations", fail);
  checkDisplay(doc["display"], fail);
  checkPlacements(doc["placements"], rowIds, itemIds, fail);

  return problems;
}

/** Throwing form, for a caller that has nothing useful to do with the list. */
export function assertValidDocument(raw: unknown): asserts raw is TierList {
  const problems = validateDocument(raw);
  if (problems.length > 0) throw new DocumentInvalidError(problems);
}

function checkEdit(value: unknown, path: string, fail: (m: string) => void): void {
  const edit = isRecord(value) ? value : null;
  if (!edit) return fail(`${path} is not an object`);

  const crop = isRecord(edit["crop"]) ? edit["crop"] : null;
  if (!crop) {
    fail(`${path}.crop is not an object`);
  } else {
    for (const axis of ["x", "y", "w", "h"] as const) {
      if (!isFinite_(crop[axis])) fail(`${path}.crop.${axis} must be a number`);
    }
    // A zero-area crop divides by zero in every mapping that scales the source
    // onto a tile, so it is rejected here rather than guarded at each of them.
    if (!(isFinite_(crop["w"]) && crop["w"] > 0)) fail(`${path}.crop.w must be positive`);
    if (!(isFinite_(crop["h"]) && crop["h"] > 0)) fail(`${path}.crop.h must be positive`);
  }

  if (!isFinite_(edit["rotation"])) fail(`${path}.rotation must be a number`);
  if (!isFinite_(edit["zoom"])) fail(`${path}.zoom must be a number`);

  const offset = isRecord(edit["offset"]) ? edit["offset"] : null;
  if (!offset) {
    fail(`${path}.offset is not an object`);
  } else {
    for (const axis of ["x", "y"] as const) {
      if (!isFinite_(offset[axis])) fail(`${path}.offset.${axis} must be a number`);
    }
  }

  checkStrokes(edit["strokes"], `${path}.strokes`, fail);
}

function checkStrokes(value: unknown, path: string, fail: (m: string) => void): void {
  if (!Array.isArray(value)) return fail(`${path} must be an array`);
  if (value.length > DOCUMENT_LIMITS.strokesPerSurface) {
    return fail(`${path} must number at most ${DOCUMENT_LIMITS.strokesPerSurface}`);
  }
  value.forEach((entry, at) => {
    const stroke = isRecord(entry) ? entry : null;
    if (!stroke) return fail(`${path}[${at}] is not an object`);
    if (typeof stroke["id"] !== "string") fail(`${path}[${at}].id must be a string`);
    if (tooLong(stroke["id"], DOCUMENT_LIMITS.idLength)) fail(`${path}[${at}].id is too long`);
    if (typeof stroke["color"] !== "string") {
      fail(`${path}[${at}].color must be a string`);
    } else if (!HEX_COLOR.test(stroke["color"])) {
      fail(`${path}[${at}].color must be a hex colour`);
    }
    if (!(isFinite_(stroke["width"]) && stroke["width"] > 0)) {
      fail(`${path}[${at}].width must be a positive number`);
    }
    const points = stroke["points"];
    if (!Array.isArray(points) || points.some((n) => !isFinite_(n))) {
      fail(`${path}[${at}].points must be an array of numbers`);
    } else if (points.length > DOCUMENT_LIMITS.strokeCoordinates) {
      fail(`${path}[${at}].points must hold at most ${DOCUMENT_LIMITS.strokeCoordinates} coordinates`);
    } else if (points.length % 2 !== 0) {
      // Points are a flat [x, y, …] pair list; an odd length leaves a
      // coordinate with no partner and every consumer reading past the end.
      fail(`${path}[${at}].points must hold an even number of coordinates`);
    }
  });
}

function checkDisplay(value: unknown, fail: (m: string) => void): void {
  const display = isRecord(value) ? value : null;
  if (!display) return fail("display is not an object");

  const tileSize = display["tileSize"];
  if (!(isFinite_(tileSize) && tileSize > 0 && tileSize <= DOCUMENT_LIMITS.tileSize)) {
    fail(`display.tileSize must be a positive number up to ${DOCUMENT_LIMITS.tileSize}`);
  }
  const labelWidth = display["labelWidth"];
  if (!(isFinite_(labelWidth) && labelWidth >= 0 && labelWidth <= DOCUMENT_LIMITS.labelWidth)) {
    fail(`display.labelWidth must be a non-negative number up to ${DOCUMENT_LIMITS.labelWidth}`);
  }
  if (typeof display["tileAspect"] !== "string" || !TILE_ASPECTS.has(display["tileAspect"])) {
    fail("display.tileAspect is not a known aspect");
  }
  if (typeof display["density"] !== "string" || !DENSITIES.has(display["density"])) {
    fail("display.density is not a known density");
  }
  if (typeof display["showLabels"] !== "boolean") {
    fail("display.showLabels must be a boolean");
  }
}

/**
 * Placements, against the invariant the `Placement` type states: one placement
 * per item, every id resolving, and indices running `0..n-1` within each
 * location with no holes and no duplicates. Consumers read `index` as a
 * position and lay a location out by it directly, which only holds here.
 */
function checkPlacements(
  value: unknown,
  rowIds: ReadonlySet<string>,
  itemIds: ReadonlySet<string>,
  fail: (m: string) => void,
): void {
  if (!Array.isArray(value)) return fail("placements must be an array");

  const seenItems = new Set<string>();
  /** `null` keys the tray; a Map takes it directly, so no sentinel is needed. */
  const byLocation = new Map<string | null, number[]>();

  value.forEach((entry, at) => {
    const placement = isRecord(entry) ? entry : null;
    if (!placement) return fail(`placements[${at}] is not an object`);

    const itemId = placement["itemId"];
    if (typeof itemId !== "string") {
      fail(`placements[${at}].itemId must be a string`);
    } else if (!itemIds.has(itemId)) {
      fail(`placements[${at}] refers to an unknown item`);
    } else if (seenItems.has(itemId)) {
      fail(`placements[${at}] is a second placement for one item`);
    } else {
      seenItems.add(itemId);
    }

    const raw = placement["rowId"];
    /** The location key: a row id, or null for the tray. */
    let rowId: string | null;
    if (raw === null) rowId = null;
    else if (typeof raw === "string") rowId = raw;
    else return fail(`placements[${at}].rowId must be a string or null`);

    if (rowId !== null && !rowIds.has(rowId)) {
      return fail(`placements[${at}] refers to an unknown row`);
    }

    if (!isIndex(placement["index"])) {
      return fail(`placements[${at}].index must be a non-negative integer`);
    }

    const location = byLocation.get(rowId);
    if (location) location.push(placement["index"]);
    else byLocation.set(rowId, [placement["index"]]);
  });

  for (const [rowId, indices] of byLocation) {
    const where = rowId === null ? "the tray" : `row ${rowId}`;
    const sorted = [...indices].sort((a, b) => a - b);
    if (sorted.some((index, position) => index !== position)) {
      fail(`placement indices in ${where} are not contiguous from 0`);
    }
  }
}
