import { describe, expect, it } from "vitest";
import type { TierListAction } from "../src/actions";
import { MAX_TAG_LENGTH, MAX_TAGS } from "../src/categories";
import { createTierList, defaultImageEdit } from "../src/factory";
import { DOCUMENT_LIMITS as L, fitText } from "../src/limits";
import { reduce } from "../src/reduce";
import type { Stroke, TierList } from "../src/types";
import { validateDocument } from "../src/validate";

const NOW = "2026-07-31T12:00:00.000Z";
const LATER = "2026-07-31T13:00:00.000Z";

function base(): TierList {
  return createTierList({ id: "list-1", now: NOW });
}

function stroke(i: number): Stroke {
  return { id: `s${i}`, points: [0.1, 0.2, 0.3, 0.4], color: "#4ade80", width: 0.01 };
}

function run(doc: TierList, actions: TierListAction[]): TierList {
  return actions.reduce((d, a) => reduce(d, a, NOW), doc);
}

/**
 * A document the API refuses is a document that never saves, so every limit a
 * person can reach through the editor is held by `reduce` itself: text is cut,
 * and additions past a count are no-ops. Each case checks both halves of that
 * — the result is still valid, and nothing past the limit landed.
 */
describe("reduce: document limits", () => {
  it("stops adding tiers at the limit, without a revision or undo step", () => {
    let doc = base();
    for (let i = doc.rows.length; i < L.rows; i += 1) {
      doc = reduce(doc, { type: "row/add", id: `r${i}`, label: "", color: "#ff4d4d" }, NOW);
    }
    expect(doc.rows).toHaveLength(L.rows);

    const next = reduce(doc, { type: "row/add", id: "one-too-many", label: "", color: "#ff4d4d" }, LATER);
    expect(next).toBe(doc);
    expect(validateDocument(doc)).toEqual([]);
  });

  it("stops adding items at the limit, of either kind", () => {
    const actions: TierListAction[] = Array.from({ length: L.items }, (_, i) => ({
      type: "item/addText",
      id: `t${i}`,
      label: "x",
    }));
    const full = run(base(), actions);
    expect(full.items).toHaveLength(L.items);

    expect(reduce(full, { type: "item/addText", id: "extra", label: "x" }, LATER)).toBe(full);
    expect(
      reduce(full, { type: "item/addImage", id: "extra-image", assetId: "a1" }, LATER),
    ).toBe(full);
    expect(validateDocument(full)).toEqual([]);
  });

  it("stops adding board strokes at the limit", () => {
    const full = run(
      base(),
      Array.from({ length: L.strokesPerSurface }, (_, i) => ({ type: "board/addStroke", stroke: stroke(i) })),
    );
    expect(full.boardAnnotations).toHaveLength(L.strokesPerSurface);
    expect(reduce(full, { type: "board/addStroke", stroke: stroke(-1) }, LATER)).toBe(full);
  });

  it("refuses a tile edit carrying more strokes than a surface may hold", () => {
    const doc = reduce(base(), { type: "item/addImage", id: "i1", assetId: "a1" }, NOW);
    const atLimit = { ...defaultImageEdit(), strokes: Array.from({ length: L.strokesPerSurface }, (_, i) => stroke(i)) };
    const pastLimit = { ...atLimit, strokes: [...atLimit.strokes, stroke(-1)] };

    const accepted = reduce(doc, { type: "item/setEdit", itemId: "i1", edit: atLimit }, NOW);
    expect(accepted.items[0]!.edit.strokes).toHaveLength(L.strokesPerSurface);
    expect(reduce(accepted, { type: "item/setEdit", itemId: "i1", edit: pastLimit }, LATER)).toBe(accepted);
  });

  it("cuts every kind of text to its limit", () => {
    const long = (n: number) => "é".repeat(n + 5);
    let doc = base();
    const rowId = doc.rows[2]!.id;
    doc = run(doc, [
      {
        type: "meta/set",
        patch: {
          title: long(L.titleLength),
          description: long(L.descriptionLength),
          tags: Array.from({ length: MAX_TAGS + 3 }, () => long(MAX_TAG_LENGTH)),
        },
      },
      { type: "row/rename", rowId, label: long(L.rowLabelLength) },
      { type: "row/add", id: "r-new", label: long(L.rowLabelLength), color: "#39b7ff" },
      { type: "item/addText", id: "t1", label: long(L.itemLabelLength) },
      { type: "item/addImage", id: "i1", assetId: "a1", label: long(L.itemLabelLength) },
    ]);

    expect(doc.title).toHaveLength(L.titleLength);
    expect(doc.description).toHaveLength(L.descriptionLength);
    expect(doc.tags).toHaveLength(MAX_TAGS);
    expect(doc.tags.every((t) => t.length === MAX_TAG_LENGTH)).toBe(true);
    expect(doc.rows.find((r) => r.id === rowId)!.label).toHaveLength(L.rowLabelLength);
    expect(doc.rows.find((r) => r.id === "r-new")!.label).toHaveLength(L.rowLabelLength);
    expect(doc.items.map((i) => i.label!.length)).toEqual([L.itemLabelLength, L.itemLabelLength]);
    expect(validateDocument(doc)).toEqual([]);
  });

  it("leaves text within its limit exactly as typed", () => {
    const title = "t".repeat(L.titleLength);
    expect(reduce(base(), { type: "meta/set", patch: { title } }, NOW).title).toBe(title);
  });

  /**
   * Arbitrary input, checked against the validator after every step: whatever
   * the sequence, the document stays one the API accepts.
   */
  it("keeps a document valid through any sequence of text edits", () => {
    let seed = 0x5eed;
    const random = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const text = () => "ab😀".repeat(Math.floor(random() * 400));

    let doc = base();
    for (let step = 0; step < 300; step += 1) {
      const rowId = doc.rows[Math.floor(random() * doc.rows.length)]!.id;
      const actions: TierListAction[] = [
        { type: "meta/set", patch: { title: text() } },
        { type: "meta/set", patch: { description: text(), tags: [text(), text()] } },
        { type: "row/rename", rowId, label: text() },
        { type: "item/addText", id: `t${step}`, label: text() },
        { type: "row/add", id: `r${step}`, label: text(), color: "#a06bff" },
      ];
      doc = reduce(doc, actions[Math.floor(random() * actions.length)]!, NOW);
      expect(validateDocument(doc)).toEqual([]);
    }
  });
});

describe("fitText", () => {
  it("never leaves half of a surrogate pair at the cut", () => {
    const text = "a".repeat(9) + "😀";
    expect(text).toHaveLength(11);
    expect(fitText(text, 10)).toBe("a".repeat(9));
    expect(fitText(text, 11)).toBe(text);
  });
});
