import { describe, expect, it } from "vitest";
import { createTierList } from "../src/factory";
import { migrate, SchemaTooNewError } from "../src/migrate";
import { SCHEMA_VERSION } from "../src/types";

const NOW = "2026-07-31T12:00:00.000Z";

describe("migrate", () => {
  it("returns a current-version document unchanged", () => {
    const doc = createTierList({ id: "list-1", now: NOW });
    expect(migrate(doc)).toEqual(doc);
  });

  it("throws SchemaTooNewError for a document from a newer client", () => {
    const doc = { ...createTierList({ id: "list-1", now: NOW }), schemaVersion: SCHEMA_VERSION + 1 };
    expect(() => migrate(doc)).toThrow(SchemaTooNewError);
  });

  it("names both versions in the error so the message is actionable", () => {
    const doc = { ...createTierList({ id: "list-1", now: NOW }), schemaVersion: 99 };
    expect(() => migrate(doc)).toThrow(/99/);
    expect(() => migrate(doc)).toThrow(new RegExp(String(SCHEMA_VERSION)));
  });

  it("rejects a value that is not an object", () => {
    expect(() => migrate(null)).toThrow(/not a tier list/i);
    expect(() => migrate("nope")).toThrow(/not a tier list/i);
  });

  it("rejects an object with no schemaVersion", () => {
    expect(() => migrate({ id: "x" })).toThrow(/schemaVersion/i);
  });
});
