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
 * Keyed by the version being migrated FROM.
 * Empty at schema 1 — the first entry gets added when schema 2 lands.
 */
const MIGRATIONS: Record<number, Migration> = {};

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
    current = step(current);
    currentVersion += 1;
    current["schemaVersion"] = currentVersion;
  }

  return current as unknown as TierList;
}
