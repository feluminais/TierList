import { describe, expect, it } from "vitest";
import { createTierList } from "../src/factory";
import { reduce } from "../src/reduce";
import { fillProgress, isFill, startFill, toTemplate } from "../src/template";
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

describe("isFill", () => {
  it("is false for an ordinary list and for a template", () => {
    const doc = filledList();
    expect(isFill(doc)).toBe(false);
    expect(isFill(toTemplate(doc, { id: "t1", now: NOW }))).toBe(false);
  });

  it("is true for a document started from another", () => {
    const template = toTemplate(filledList(), { id: "t1", now: NOW });
    expect(isFill(startFill(template, { id: "f1", now: NOW }))).toBe(true);
  });
});

describe("fillProgress", () => {
  it("counts nothing placed in a fresh fill", () => {
    const template = toTemplate(filledList(), { id: "t1", now: NOW });
    const fill = startFill(template, { id: "f1", now: NOW });
    const progress = fillProgress(fill);
    expect(progress.placed).toBe(0);
    expect(progress.total).toBe(fill.items.length);
    expect(progress.total).toBeGreaterThan(0);
    expect(progress.fraction).toBe(0);
  });

  it("counts an item once it is in a tier", () => {
    const template = toTemplate(filledList(), { id: "t1", now: NOW });
    let fill = startFill(template, { id: "f1", now: NOW });
    const rowId = fill.rows[0]!.id;
    fill = reduce(fill, { type: "placement/place", itemId: fill.items[0]!.id, rowId, index: 0 }, NOW);

    expect(fillProgress(fill).placed).toBe(1);
  });

  it("stops counting an item returned to the tray", () => {
    const template = toTemplate(filledList(), { id: "t1", now: NOW });
    let fill = startFill(template, { id: "f1", now: NOW });
    const itemId = fill.items[0]!.id;
    fill = reduce(fill, { type: "placement/place", itemId, rowId: fill.rows[0]!.id, index: 0 }, NOW);
    fill = reduce(fill, { type: "placement/unplace", itemId }, NOW);

    expect(fillProgress(fill).placed).toBe(0);
  });

  it("reads a fully placed fill as complete", () => {
    const template = toTemplate(filledList(), { id: "t1", now: NOW });
    let fill = startFill(template, { id: "f1", now: NOW });
    const rowId = fill.rows[0]!.id;
    for (const [index, item] of fill.items.entries()) {
      fill = reduce(fill, { type: "placement/place", itemId: item.id, rowId, index }, NOW);
    }
    const progress = fillProgress(fill);
    expect(progress.placed).toBe(progress.total);
    expect(progress.fraction).toBe(1);
  });

  /**
   * `migrate()` performs no structural validation, so a stored document can
   * carry an item with no placement at all. Counting placements rather than
   * items would report a total the board does not show.
   */
  it("treats an item with no placement as unplaced, not as absent", () => {
    const template = toTemplate(filledList(), { id: "t1", now: NOW });
    const fill = startFill(template, { id: "f1", now: NOW });
    const orphaned = { ...fill, placements: fill.placements.slice(1) };

    const progress = fillProgress(orphaned);
    expect(progress.total).toBe(fill.items.length);
    expect(progress.placed).toBe(0);
  });

  it("calls an empty list complete rather than dividing by zero", () => {
    const empty = { ...filledList(), items: [], placements: [] };
    expect(fillProgress(empty)).toEqual({ placed: 0, total: 0, fraction: 1 });
  });
});
