import { SCHEMA_VERSION, type TierList } from "./types";

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

/** A migration takes a document at version N and returns it at version N+1. */
type Migration = (doc: Record<string, unknown>) => Record<string, unknown>;

/**
 * Narrow an untrusted field to a record, or null if it is not one.
 *
 * `Array.isArray` is load-bearing, not belt-and-braces: `typeof [] ===
 * "object"`, so without it an array reached from `JSON.parse` is treated as a
 * record — spreading it converts it to a plain object, and reading a key off
 * it yields `undefined` rather than "absent". `migrate()` below applies the
 * same three-part guard to the document itself; every migration over
 * `Record<string, unknown>` wants it too, which is why it lives here rather
 * than inside one of them.
 */
const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/**
 * Schema 2's whole content is the contiguity invariant on the `Placement`
 * docblock: within every location the indices run `0..n-1`, so a consumer may
 * read `index` as a position. Schema 1 kept that nowhere, so the migration has
 * to establish it everywhere — a version bump that delivered it for the tray
 * and not for rows would be worse than none, because the promise is what the
 * editor is about to lay tiles out on.
 *
 * Each location is renumbered from the ordering signal it actually carries,
 * which differs between the two:
 *
 * - A **row** already holds a real ordering that has merely been damaged.
 *   Schema 1's `item/remove` and its cross-row `place` both dropped a
 *   placement without closing the hole behind it, leaving indices like
 *   `[0, 2]`; closing a hole below a survivor could also shift a row off zero
 *   entirely, leaving `[1]`. Sorting by the existing index and reassigning
 *   `0..n-1` repairs both without inventing an order.
 * - The **tray** holds no ordering at all: schema 1 wrote every tray placement
 *   at `index: 0`. Item `order` is the only signal left, so the tray adopts
 *   it.
 *
 * Placements tied on their sort key keep the order the array held, `sort`
 * being stable — arbitrary, but deterministic, and still contiguous.
 *
 * Written defensively against `Record<string, unknown>` rather than `TierList`:
 * the input is by definition a document this version of the code has never
 * validated, and a migration that throws on a malformed field makes a document
 * unopenable rather than imperfect.
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

  const byLocation = new Map<string | symbol, Record<string, unknown>[]>();
  for (const value of placements) {
    const p = asRecord(value);
    if (!p) continue;
    const location = locationOf(p);
    if (location === null) continue;
    const group = byLocation.get(location);
    if (group) group.push(p);
    else byLocation.set(location, [p]);
  }

  const itemOrderKey = (p: Record<string, unknown>): number => {
    const id = p["itemId"];
    return (typeof id === "string" ? orderOf.get(id) : undefined) ?? 0;
  };
  const existingIndexKey = (p: Record<string, unknown>): number => {
    const index = p["index"];
    return typeof index === "number" ? index : 0;
  };

  // Keyed by the placement itself, not by its `itemId`: the placement is what
  // is being numbered, and nothing here has established that ids are unique.
  const nextIndex = new Map<Record<string, unknown>, number>();
  for (const [location, group] of byLocation) {
    const key = location === TRAY ? itemOrderKey : existingIndexKey;
    [...group]
      .sort((a, b) => key(a) - key(b))
      .forEach((p, index) => nextIndex.set(p, index));
  }

  return {
    ...doc,
    placements: placements.map((value) => {
      const p = asRecord(value);
      if (!p) return value;
      const index = nextIndex.get(p);
      return index === undefined ? value : { ...p, index };
    }),
  };
};

/** Keyed by the version being migrated FROM. */
const MIGRATIONS: Record<number, Migration> = {
  1: migrateV1ToV2,
};

/**
 * Bring a stored document up to the current schema.
 *
 * Structural validation is a known gap: this checks `schemaVersion` and
 * nothing else, so a document violating a model invariant — a holed set of
 * placement indices, say — survives the cast at the end. That is deliberate
 * for now rather than an oversight elsewhere: `reduce()` trusts its input (see
 * the `Placement` docblock), which makes this function, not the reducer, the
 * right home for such checks when they get built.
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
    // Spread rather than assign into `step`'s result: a migration with nothing
    // to change may legitimately hand its input straight back, and writing the
    // stamp in place would then land on the caller's object. `migrate()` is
    // called on request bodies and stored rows; it does not own either.
    current = { ...step(current), schemaVersion: currentVersion };
  }

  return current as unknown as TierList;
}
