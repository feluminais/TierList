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

/**
 * A migration takes a document at version N and returns it at version N+1.
 *
 * Three rules, all load-bearing, all of them things `migrate()` relies on. If
 * you are writing the schema 3 step by reading `migrateV1ToV2`, these are the
 * parts of the contract that are not visible from there:
 *
 * - **Must not mutate its input.** `migrate()` runs on HTTP request bodies
 *   (`services/api/src/routes.ts`) and on rows read from the database; it owns
 *   neither. Return new objects; sharing untouched sub-trees with the input is
 *   fine, writing into them is not.
 * - **Must not stamp `schemaVersion` itself** — the runner does it. That is
 *   what lets a migration with nothing to change hand its input straight back
 *   without the stamp landing on the caller's object.
 * - **Must not throw on a malformed field.** The input is by definition a
 *   document this version of the code has never validated. Throwing makes such
 *   a document unopenable rather than imperfect, so leave a field you cannot
 *   make sense of exactly as you found it. `asRecord` below is the usual way
 *   to say that.
 */
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
 * Every `asRecord` and `typeof` guard below is the third rule on `Migration`
 * being kept, not defensive habit: a malformed field is left exactly as found.
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
   * placement. A slot is what gets numbered, and two slots may hold the same
   * object reference — not from `JSON.parse`, but `migrate` is exported, so an
   * in-process caller can hand one in. Keyed by object, such a pair is
   * assigned twice and the last write wins, producing a location with no zero
   * and a duplicate: the invariant this step exists to establish, broken.
   * Positions are unique by construction.
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
      // A slot absent from the map was skipped as unfilable above, and is
      // handed back untouched — the same value, not a copy of it. The `!p` is
      // narrowing, not a second case: a slot only reaches the map by having
      // been a record when it was grouped.
      if (index === undefined || !p) return value;
      return { ...p, index };
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
    // Spread rather than assign: the `Migration` contract lets a step with
    // nothing to change hand its input straight back, so stamping in place
    // would write through to the caller's object.
    current = { ...step(current), schemaVersion: currentVersion };
  }

  return current as unknown as TierList;
}
