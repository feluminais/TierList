import { DEFAULT_STROKE_WIDTH, SCHEMA_VERSION, type TierList } from "./types";

export class SchemaTooNewError extends Error {
  constructor(found: number, supported: number) {
    super(
      `This tier list was saved by a newer version of the app ` +
        `(schema ${found}); this client supports up to schema ${supported}. ` +
        `Update the app to open it.`,
    );
    this.name = "SchemaTooNewError";
  }
}

/**
 * A migration takes a document at version N and returns it at version N+1.
 *
 * Three rules, none of them visible from a single migration's body:
 *
 * - **Must not mutate its input.** `migrate()` runs on HTTP request bodies and
 *   on rows read from the database, and owns neither. Return new objects;
 *   sharing untouched sub-trees with the input is fine, writing into them is
 *   not.
 * - **Must not stamp `schemaVersion` itself** — the runner does. That is what
 *   lets a migration with nothing to change hand its input straight back
 *   without the stamp landing on the caller's object.
 * - **Must not throw on a malformed field.** The input is a document this
 *   version of the code has never seen. Throwing makes it unopenable rather
 *   than imperfect, so a field that makes no sense is left exactly as found.
 *   `asRecord` below is the usual way to say that. Refusing a bad document is
 *   `validateDocument`'s job, not a migration's.
 */
type Migration = (doc: Record<string, unknown>) => Record<string, unknown>;

/**
 * Narrow an untrusted field to a record, or null if it is not one.
 *
 * The `Array.isArray` clause is required rather than defensive: `typeof [] ===
 * "object"`, so without it an array from `JSON.parse` counts as a record —
 * spreading one converts it to a plain object, and reading a key off it yields
 * `undefined` rather than "absent".
 */
const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/**
 * Schema 2 establishes the contiguity invariant on the `Placement` docblock:
 * within every location the indices run `0..n-1`, so a consumer may read
 * `index` as a position. Schema 1 guaranteed it nowhere, so this has to
 * establish it in every location — one that covered the tray and not rows
 * would be worse than none, because laying tiles out is what reads it.
 *
 * Each location is renumbered from the ordering signal it carries, and the two
 * differ:
 *
 * - A **row** holds a real ordering that may have holes, or may never reach
 *   zero. Sorting by the existing index and reassigning `0..n-1` repairs both
 *   without inventing an order.
 * - The **tray** holds no ordering: schema 1 put every tray placement at index
 *   0. Item `order` is the only signal left, so the tray adopts it.
 *
 * Placements tied on their sort key keep the order the array held, `sort`
 * being stable — arbitrary, deterministic, and still contiguous.
 *
 * Every `asRecord` and `typeof` guard below is the third `Migration` rule
 * being kept: a malformed field is left exactly as found.
 */
const migrateV1ToV2: Migration = (doc) => {
  const placements = doc["placements"];
  const items = doc["items"];
  if (!Array.isArray(placements)) return doc;

  /** The tray, as a location key. A row's key is its id, which is a string. */
  const TRAY = Symbol("tray");

  const orderOf = new Map<string, number>();
  if (Array.isArray(items)) {
    items.forEach((item, position) => {
      const record = asRecord(item);
      if (!record) return;
      const id = record["id"];
      const order = record["order"];
      if (typeof id !== "string") return;
      orderOf.set(id, typeof order === "number" ? order : position);
    });
  }

  /**
   * The location a placement belongs to, or null for one too malformed to
   * file: `rowId` present but not a string. Those are left exactly as they
   * are rather than guessed into a location they may not belong in.
   */
  const locationOf = (p: Record<string, unknown>): string | symbol | null => {
    const rowId = p["rowId"];
    // `== null` deliberately: catches both an explicit null and a missing key.
    if (rowId == null) return TRAY;
    return typeof rowId === "string" ? rowId : null;
  };

  /**
   * Groups hold the *position* a placement occupies in `placements`, not the
   * placement itself. A slot is what gets numbered, and two slots may hold the
   * same object reference — `JSON.parse` cannot produce that, but `migrate` is
   * exported and an in-process caller can. Keyed by object, such a pair would
   * be assigned twice with the last write winning, producing exactly the
   * duplicate this step exists to remove. Positions are unique by construction.
   */
  const byLocation = new Map<
    string | symbol,
    { at: number; p: Record<string, unknown> }[]
  >();
  placements.forEach((value, at) => {
    const p = asRecord(value);
    if (!p) return;
    const location = locationOf(p);
    if (location === null) return;
    const group = byLocation.get(location);
    if (group) group.push({ at, p });
    else byLocation.set(location, [{ at, p }]);
  });

  const itemOrderKey = (p: Record<string, unknown>): number => {
    const id = p["itemId"];
    return (typeof id === "string" ? orderOf.get(id) : undefined) ?? 0;
  };
  const existingIndexKey = (p: Record<string, unknown>): number => {
    const index = p["index"];
    return typeof index === "number" ? index : 0;
  };

  /** Position in `placements` -> the index that slot should now carry. */
  const nextIndex = new Map<number, number>();
  for (const [location, group] of byLocation) {
    const key = location === TRAY ? itemOrderKey : existingIndexKey;
    [...group]
      .sort((a, b) => key(a.p) - key(b.p))
      .forEach(({ at }, index) => nextIndex.set(at, index));
  }

  return {
    ...doc,
    placements: placements.map((value, at) => {
      const index = nextIndex.get(at);
      const p = asRecord(value);
      // A slot absent from the map could not be filed into a location above,
      // and is handed back untouched — the same value, not a copy. The `!p` is
      // narrowing rather than a second case: a slot only reaches the map by
      // having been a record when it was grouped.
      if (index === undefined || !p) return value;
      return { ...p, index };
    }),
  };
};

/**
 * Schema 3 redefines `Stroke.width` as a fraction of the source image's width
 * rather than a pixel count. The two units cannot be converted into one
 * another: the pixel figure described a thickness on whichever surface drew
 * the stroke, and the document does not record which that was. Every stored
 * width is therefore reset to the current default.
 *
 * Both places a stroke can live are rewritten — an item's edit and the
 * board-level annotations — because one renderer reads both.
 */
const migrateV2ToV3: Migration = (doc) => {
  const rewriteStrokes = (value: unknown): unknown => {
    if (!Array.isArray(value)) return value;
    return value.map((stroke) => {
      const record = asRecord(stroke);
      return record ? { ...record, width: DEFAULT_STROKE_WIDTH } : stroke;
    });
  };

  const items = doc["items"];
  const next: Record<string, unknown> = { ...doc };

  if (Array.isArray(items)) {
    next["items"] = items.map((value) => {
      const item = asRecord(value);
      const edit = item && asRecord(item["edit"]);
      if (!item || !edit) return value;
      return { ...item, edit: { ...edit, strokes: rewriteStrokes(edit["strokes"]) } };
    });
  }

  if (Array.isArray(doc["boardAnnotations"])) {
    next["boardAnnotations"] = rewriteStrokes(doc["boardAnnotations"]);
  }

  return next;
};

/** Keyed by the version being migrated FROM. */
const MIGRATIONS: Record<number, Migration> = {
  1: migrateV1ToV2,
  2: migrateV2ToV3,
};

/**
 * Bring a stored document up to the current schema.
 *
 * Version conversion only. This checks `schemaVersion` and nothing else, so a
 * document violating a model invariant survives the cast at the end — refusing
 * one is `validateDocument`'s job. A caller taking untrusted input runs both,
 * in that order.
 */
export function migrate(raw: unknown): TierList {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("Value is not a tier list document.");
  }

  const doc = raw as Record<string, unknown>;
  const version = doc["schemaVersion"];

  if (typeof version !== "number") {
    throw new Error("Document has no numeric schemaVersion.");
  }

  if (version > SCHEMA_VERSION) {
    throw new SchemaTooNewError(version, SCHEMA_VERSION);
  }

  let current = doc;
  let currentVersion = version;

  while (currentVersion < SCHEMA_VERSION) {
    const step = MIGRATIONS[currentVersion];
    if (!step) {
      throw new Error(
        `No migration registered from schema ${currentVersion} to ${currentVersion + 1}.`,
      );
    }
    currentVersion += 1;
    // Spread rather than assign: a step with nothing to change may hand its
    // input straight back, so stamping in place would write through to the
    // caller's object.
    current = { ...step(current), schemaVersion: currentVersion };
  }

  return current as unknown as TierList;
}
