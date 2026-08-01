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
 * Schema 1 wrote every tray placement with `index: 0`, so the tray had no
 * order at all. Schema 2 lays the tray out by index like any row, which means
 * those zeros have to become a real sequence. Item `order` is the only stable
 * ordering signal a v1 document carries, so the tray adopts it. Items sharing
 * an `order` keep the order the placements array held, `sort` being stable —
 * arbitrary, but deterministic, and still contiguous.
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

  const orderOf = new Map<string, number>();
  if (Array.isArray(items)) {
    items.forEach((item, position) => {
      if (typeof item !== "object" || item === null) return;
      const record = item as Record<string, unknown>;
      const id = record["id"];
      const order = record["order"];
      if (typeof id !== "string") return;
      orderOf.set(id, typeof order === "number" ? order : position);
    });
  }

  const isTray = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" &&
    value !== null &&
    // `== null` deliberately: catches both an explicit null and a missing key.
    (value as Record<string, unknown>)["rowId"] == null;

  const trayIndex = new Map<string, number>();
  placements
    .filter(isTray)
    .map((p) => p["itemId"])
    .filter((id): id is string => typeof id === "string")
    .sort((a, b) => (orderOf.get(a) ?? 0) - (orderOf.get(b) ?? 0))
    .forEach((id, index) => trayIndex.set(id, index));

  return {
    ...doc,
    placements: placements.map((p) => {
      if (!isTray(p)) return p;
      const id = p["itemId"];
      if (typeof id !== "string") return p;
      return { ...p, index: trayIndex.get(id) ?? 0 };
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
