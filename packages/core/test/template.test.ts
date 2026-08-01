import { describe, expect, it } from "vitest";
import { createTierList } from "../src/factory";
import { reduce } from "../src/reduce";
import { startFill, toTemplate } from "../src/template";
import type { TierList } from "../src/types";

const NOW = "2026-07-31T12:00:00.000Z";
const LATER = "2026-08-01T09:00:00.000Z";
const S = "list-1-row-0";

function filledList(): TierList {
  let doc = createTierList({ id: "list-1", now: NOW, title: "Ramen" });
  doc = reduce(doc, { type: "item/addText", id: "i1", label: "Tonkotsu" }, NOW);
  doc = reduce(doc, { type: "item/addText", id: "i2", label: "Shoyu" }, NOW);
  doc = reduce(doc, { type: "placement/place", itemId: "i1", rowId: S, index: 0 }, NOW);
  return doc;
}

describe("toTemplate", () => {
  it("keeps rows, items and display settings", () => {
    const t = toTemplate(filledList(), { id: "tpl-1", now: LATER });
    expect(t.rows).toHaveLength(5);
    expect(t.items.map((i) => i.id)).toEqual(["i1", "i2"]);
    expect(t.display).toEqual(filledList().display);
  });

  it("clears every placement back to the tray", () => {
    const t = toTemplate(filledList(), { id: "tpl-1", now: LATER });
    expect(t.placements).toHaveLength(2);
    expect(t.placements.every((p) => p.rowId === null)).toBe(true);
  });

  it("takes the new id and timestamps and resets revision", () => {
    const t = toTemplate(filledList(), { id: "tpl-1", now: LATER });
    expect(t.id).toBe("tpl-1");
    expect(t.createdAt).toBe(LATER);
    expect(t.updatedAt).toBe(LATER);
    expect(t.revision).toBe(0);
  });

  it("is not itself derived from a template", () => {
    const t = toTemplate(filledList(), { id: "tpl-1", now: LATER });
    expect(t.templateId).toBeUndefined();
    expect(t.templateRevision).toBeUndefined();
  });

  it("clears templateRevision when publishing a fill as a new template", () => {
    const original = toTemplate(filledList(), { id: "tpl-1", now: LATER });
    const fill = startFill(original, { id: "fill-1", now: LATER });
    expect(fill.templateRevision).toBe(0);

    const republished = toTemplate(fill, { id: "tpl-2", now: LATER });
    expect(republished.templateId).toBeUndefined();
    expect(republished.templateRevision).toBeUndefined();
  });

  it("does not mutate the source list", () => {
    const source = filledList();
    toTemplate(source, { id: "tpl-1", now: LATER });
    expect(source.placements.find((p) => p.itemId === "i1")!.rowId).toBe(S);
  });
});

describe("startFill", () => {
  it("points back at the template it came from", () => {
    const t = toTemplate(filledList(), { id: "tpl-1", now: LATER });
    const fill = startFill(t, { id: "fill-1", now: LATER, authorId: "user-2" });
    expect(fill.templateId).toBe("tpl-1");
    expect(fill.authorId).toBe("user-2");
  });

  it("records the template revision it was ranked against", () => {
    let t = toTemplate(filledList(), { id: "tpl-1", now: LATER });
    t = reduce(t, { type: "row/add", id: "row-f", label: "F", color: "#888888" }, LATER);
    expect(t.revision).toBe(1);

    const fill = startFill(t, { id: "fill-1", now: LATER });
    expect(fill.templateRevision).toBe(1);
  });

  it("does not inherit the template's own revision counter as its own", () => {
    let t = toTemplate(filledList(), { id: "tpl-1", now: LATER });
    t = reduce(t, { type: "row/add", id: "row-f", label: "F", color: "#888888" }, LATER);

    const fill = startFill(t, { id: "fill-1", now: LATER });
    expect(fill.revision).toBe(0);
    expect(fill.templateRevision).toBe(1);
  });

  it("preserves item ids exactly, because compare matches on them", () => {
    const t = toTemplate(filledList(), { id: "tpl-1", now: LATER });
    const fill = startFill(t, { id: "fill-1", now: LATER });
    expect(fill.items.map((i) => i.id)).toEqual(t.items.map((i) => i.id));
  });

  it("starts with everything unranked", () => {
    const t = toTemplate(filledList(), { id: "tpl-1", now: LATER });
    const fill = startFill(t, { id: "fill-1", now: LATER });
    expect(fill.placements.every((p) => p.rowId === null)).toBe(true);
  });

  it("copies row ids so two fills of one template are comparable", () => {
    const t = toTemplate(filledList(), { id: "tpl-1", now: LATER });
    const a = startFill(t, { id: "fill-a", now: LATER });
    const b = startFill(t, { id: "fill-b", now: LATER });
    expect(a.rows.map((r) => r.id)).toEqual(b.rows.map((r) => r.id));
  });
});
