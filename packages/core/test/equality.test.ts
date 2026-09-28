import { describe, expect, it } from "vitest";
import { sameDocument } from "../src/equality";
import { createTierList } from "../src/factory";
import { reduce } from "../src/reduce";
import type { TierList } from "../src/types";

const NOW = "2026-07-31T12:00:00.000Z";

function doc(): TierList {
  let d = createTierList({ id: "list-1", now: NOW, title: "Ramen" });
  d = reduce(d, { type: "item/addText", id: "t1", label: "Tonkotsu" }, NOW);
  d = reduce(d, { type: "placement/place", itemId: "t1", rowId: d.rows[1]!.id, index: 0 }, NOW);
  return d;
}

/** Rebuilds every object in a value with its keys in reverse order. */
function reorderKeys<T>(value: T): T {
  if (Array.isArray(value)) return value.map(reorderKeys) as T;
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .reverse()
        .map(([k, v]) => [k, reorderKeys(v)]),
    ) as T;
  }
  return value;
}

describe("sameDocument", () => {
  it("treats a document as equal to itself after its keys are reordered at every depth", () => {
    const original = doc();
    const reordered = reorderKeys(original);
    expect(JSON.stringify(reordered)).not.toBe(JSON.stringify(original));
    expect(sameDocument(original, reordered)).toBe(true);
  });

  it("tells apart documents that differ in one nested value", () => {
    const a = doc();
    const b = reduce(a, { type: "row/rename", rowId: a.rows[3]!.id, label: "Z" }, NOW);
    expect(sameDocument(a, { ...b, revision: a.revision, updatedAt: a.updatedAt })).toBe(false);
  });

  /** Array order is content — a placement's position in a list is meaningful. */
  it("does not treat reordered arrays as equal", () => {
    const a = doc();
    const b = { ...a, rows: [...a.rows].reverse() };
    expect(sameDocument(a, b)).toBe(false);
  });
});
