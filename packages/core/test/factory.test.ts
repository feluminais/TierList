import { describe, expect, it } from "vitest";
import { createTierList, defaultImageEdit } from "../src/factory";
import { SCHEMA_VERSION } from "../src/types";

const NOW = "2026-07-31T12:00:00.000Z";

describe("createTierList", () => {
  it("stamps the current schema version", () => {
    const doc = createTierList({ id: "list-1", now: NOW });
    expect(doc.schemaVersion).toBe(SCHEMA_VERSION);
  });

  it("uses the supplied id and timestamps", () => {
    const doc = createTierList({ id: "list-1", now: NOW });
    expect(doc.id).toBe("list-1");
    expect(doc.createdAt).toBe(NOW);
    expect(doc.updatedAt).toBe(NOW);
    expect(doc.revision).toBe(0);
  });

  it("creates five default rows in S-to-D order", () => {
    const doc = createTierList({ id: "list-1", now: NOW });
    expect(doc.rows.map((r) => r.label)).toEqual(["S", "A", "B", "C", "D"]);
    expect(doc.rows.map((r) => r.order)).toEqual([0, 1, 2, 3, 4]);
  });

  it("gives every default row a distinct id and colour", () => {
    const doc = createTierList({ id: "list-1", now: NOW });
    expect(new Set(doc.rows.map((r) => r.id)).size).toBe(5);
    expect(new Set(doc.rows.map((r) => r.color)).size).toBe(5);
  });

  it("starts with no items and no placements", () => {
    const doc = createTierList({ id: "list-1", now: NOW });
    expect(doc.items).toEqual([]);
    expect(doc.placements).toEqual([]);
  });

  it("accepts an optional title", () => {
    const doc = createTierList({ id: "list-1", now: NOW, title: "Ramen" });
    expect(doc.title).toBe("Ramen");
  });

  it("is not derived from a template", () => {
    const doc = createTierList({ id: "list-1", now: NOW });
    expect(doc.templateId).toBeUndefined();
    expect(doc.templateRevision).toBeUndefined();
  });
});

describe("defaultImageEdit", () => {
  it("is a full-frame, unrotated, unzoomed edit with no strokes", () => {
    expect(defaultImageEdit()).toEqual({
      crop: { x: 0, y: 0, w: 1, h: 1 },
      rotation: 0,
      zoom: 1,
      offset: { x: 0, y: 0 },
      strokes: [],
    });
  });

  it("returns a fresh object each call", () => {
    expect(defaultImageEdit()).not.toBe(defaultImageEdit());
  });
});
