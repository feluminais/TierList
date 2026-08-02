import { describe, expect, it } from "vitest";
import { createTierList, defaultImageEdit } from "../src/factory";
import { reduce } from "../src/reduce";
import { startFill, toTemplate } from "../src/template";
import { DEFAULT_STROKE_WIDTH, type TierList } from "../src/types";
import { assertValidDocument, DocumentInvalidError, validateDocument } from "../src/validate";

const NOW = "2026-07-31T12:00:00.000Z";

function base(): TierList {
  return createTierList({ id: "list-1", now: NOW });
}

/** A document with one of every shape the model can hold. */
function populated(): TierList {
  let doc = base();
  doc = reduce(doc, { type: "item/addText", id: "t1", label: "text" }, NOW);
  doc = reduce(
    doc,
    {
      type: "item/addImage",
      id: "i1",
      assetId: "asset-1",
      edit: {
        ...defaultImageEdit(),
        strokes: [
          { id: "s1", points: [0, 0, 1, 1], color: "#fff", width: DEFAULT_STROKE_WIDTH },
        ],
      },
    },
    NOW,
  );
  const rowId = doc.rows[0]!.id;
  doc = reduce(doc, { type: "placement/place", itemId: "t1", rowId, index: 0 }, NOW);
  doc = reduce(doc, { type: "row/setTileSize", rowId, tileSize: 120 }, NOW);
  return doc;
}

describe("validateDocument", () => {
  it("accepts a freshly created document", () => {
    expect(validateDocument(base())).toEqual([]);
  });

  it("accepts a document carrying rows, items, strokes and placements", () => {
    expect(validateDocument(populated())).toEqual([]);
  });

  it("accepts what the template helpers derive", () => {
    const template = toTemplate(populated(), { id: "tpl", now: NOW });
    expect(validateDocument(template)).toEqual([]);
    expect(validateDocument(startFill(template, { id: "fill", now: NOW }))).toEqual([]);
  });

  it("reports every fault it finds rather than only the first", () => {
    const problems = validateDocument({ ...base(), id: 1, title: null, revision: "x" });
    expect(problems.length).toBeGreaterThanOrEqual(3);
  });

  it("rejects a value that is not an object", () => {
    expect(validateDocument(null)).toEqual(["document is not an object"]);
    expect(validateDocument([])).toEqual(["document is not an object"]);
  });
});

/**
 * Every case here reaches the database as a projected column or reaches a
 * renderer as geometry, so each is a shape that has to be refused at the
 * boundary rather than carried inward.
 */
describe("validateDocument: field types", () => {
  const cases: { name: string; patch: Record<string, unknown>; match: RegExp }[] = [
    { name: "a non-string id", patch: { id: 7 }, match: /id must be a string/ },
    { name: "a non-string title", patch: { title: {} }, match: /title must be a string/ },
    { name: "a negative revision", patch: { revision: -1 }, match: /revision/ },
    { name: "a fractional revision", patch: { revision: 1.5 }, match: /revision/ },
    { name: "an unparseable createdAt", patch: { createdAt: "nope" }, match: /createdAt/ },
    { name: "an unparseable updatedAt", patch: { updatedAt: "" }, match: /updatedAt/ },
    { name: "a categoryId that is neither", patch: { categoryId: 3 }, match: /categoryId/ },
    { name: "tags that are not strings", patch: { tags: [1] }, match: /tags/ },
    { name: "rows that are not an array", patch: { rows: {} }, match: /rows must be an array/ },
    { name: "items that are not an array", patch: { items: null }, match: /items must be an array/ },
    {
      name: "placements that are not an array",
      patch: { placements: 0 },
      match: /placements must be an array/,
    },
    { name: "a missing display", patch: { display: undefined }, match: /display/ },
    {
      name: "an unknown tile aspect",
      patch: { display: { ...base().display, tileAspect: "diamond" } },
      match: /tileAspect/,
    },
    {
      name: "a zero tile size",
      patch: { display: { ...base().display, tileSize: 0 } },
      match: /tileSize/,
    },
    {
      name: "board annotations that are not an array",
      patch: { boardAnnotations: "none" },
      match: /boardAnnotations/,
    },
  ];

  it.each(cases)("rejects $name", ({ patch, match }) => {
    const problems = validateDocument({ ...base(), ...patch });
    expect(problems.join("; ")).toMatch(match);
  });
});

describe("validateDocument: rows and items", () => {
  it("rejects duplicate row ids", () => {
    const doc = base();
    const problems = validateDocument({ ...doc, rows: [doc.rows[0]!, doc.rows[0]!] });
    expect(problems.join("; ")).toMatch(/duplicate/);
  });

  it("rejects duplicate item ids", () => {
    const doc = populated();
    const problems = validateDocument({
      ...doc,
      items: [doc.items[0]!, doc.items[0]!],
      placements: [],
    });
    expect(problems.join("; ")).toMatch(/duplicate/);
  });

  it("rejects an image item with no assetId", () => {
    const doc = populated();
    const items = doc.items.map((i) =>
      i.kind === "image" ? { ...i, assetId: undefined } : i,
    );
    expect(validateDocument({ ...doc, items }).join("; ")).toMatch(/assetId/);
  });

  it("rejects a tileSizeOverride that is not positive", () => {
    const doc = base();
    const rows = doc.rows.map((r, i) => (i === 0 ? { ...r, tileSizeOverride: 0 } : r));
    expect(validateDocument({ ...doc, rows }).join("; ")).toMatch(/tileSizeOverride/);
  });
});

/**
 * A crop with no area divides by zero in every mapping that scales the source
 * onto a tile, and a stroke width of zero draws nothing while looking like
 * data. Both are refused here so the mappings need no guard of their own.
 */
describe("validateDocument: edits and strokes", () => {
  function withEdit(patch: Record<string, unknown>): string[] {
    const doc = populated();
    const items = doc.items.map((i) =>
      i.kind === "image" ? { ...i, edit: { ...i.edit, ...patch } } : i,
    );
    return validateDocument({ ...doc, items });
  }

  it("rejects a zero-width crop", () => {
    expect(withEdit({ crop: { x: 0, y: 0, w: 0, h: 1 } }).join("; ")).toMatch(/crop\.w/);
  });

  it("rejects a zero-height crop", () => {
    expect(withEdit({ crop: { x: 0, y: 0, w: 1, h: 0 } }).join("; ")).toMatch(/crop\.h/);
  });

  it("rejects a non-numeric crop coordinate", () => {
    expect(withEdit({ crop: { x: "0", y: 0, w: 1, h: 1 } }).join("; ")).toMatch(/crop\.x/);
  });

  it("rejects a non-finite zoom", () => {
    expect(withEdit({ zoom: Number.POSITIVE_INFINITY }).join("; ")).toMatch(/zoom/);
  });

  it("rejects strokes that are not an array", () => {
    expect(withEdit({ strokes: {} }).join("; ")).toMatch(/strokes must be an array/);
  });

  it("rejects a stroke with an odd number of coordinates", () => {
    const strokes = [{ id: "s", points: [0, 0, 1], color: "#fff", width: 0.02 }];
    expect(withEdit({ strokes }).join("; ")).toMatch(/even number/);
  });

  it("rejects a stroke point that is not a number", () => {
    const strokes = [{ id: "s", points: [0, "0"], color: "#fff", width: 0.02 }];
    expect(withEdit({ strokes }).join("; ")).toMatch(/points/);
  });

  it("rejects a stroke width of zero", () => {
    const strokes = [{ id: "s", points: [0, 0, 1, 1], color: "#fff", width: 0 }];
    expect(withEdit({ strokes }).join("; ")).toMatch(/width/);
  });
});

describe("validateDocument: placement invariants", () => {
  function withPlacements(placements: unknown[]): string[] {
    return validateDocument({ ...populated(), placements });
  }

  it("rejects a placement for an item that does not exist", () => {
    expect(withPlacements([{ itemId: "ghost", rowId: null, index: 0 }]).join("; ")).toMatch(
      /unknown item/,
    );
  });

  it("rejects a placement in a row that does not exist", () => {
    expect(withPlacements([{ itemId: "t1", rowId: "ghost", index: 0 }]).join("; ")).toMatch(
      /unknown row/,
    );
  });

  it("rejects two placements for one item", () => {
    const rowId = populated().rows[0]!.id;
    const problems = withPlacements([
      { itemId: "t1", rowId, index: 0 },
      { itemId: "t1", rowId: null, index: 0 },
    ]);
    expect(problems.join("; ")).toMatch(/second placement/);
  });

  it("rejects a hole in a location's indices", () => {
    const problems = withPlacements([
      { itemId: "t1", rowId: null, index: 0 },
      { itemId: "i1", rowId: null, index: 2 },
    ]);
    expect(problems.join("; ")).toMatch(/not contiguous/);
  });

  it("rejects a location that never reaches index 0", () => {
    const problems = withPlacements([{ itemId: "t1", rowId: null, index: 1 }]);
    expect(problems.join("; ")).toMatch(/not contiguous/);
  });

  it("rejects duplicate indices within one location", () => {
    const problems = withPlacements([
      { itemId: "t1", rowId: null, index: 0 },
      { itemId: "i1", rowId: null, index: 0 },
    ]);
    expect(problems.join("; ")).toMatch(/not contiguous/);
  });

  it("numbers each location independently", () => {
    const rowId = populated().rows[0]!.id;
    expect(
      withPlacements([
        { itemId: "t1", rowId, index: 0 },
        { itemId: "i1", rowId: null, index: 0 },
      ]),
    ).toEqual([]);
  });

  it("rejects a fractional index", () => {
    expect(withPlacements([{ itemId: "t1", rowId: null, index: 0.5 }]).join("; ")).toMatch(
      /index/,
    );
  });
});

describe("assertValidDocument", () => {
  it("returns for a valid document", () => {
    expect(() => assertValidDocument(base())).not.toThrow();
  });

  it("throws DocumentInvalidError carrying the problems", () => {
    try {
      assertValidDocument({ ...base(), id: 1 });
      throw new Error("expected a throw");
    } catch (e) {
      expect(e).toBeInstanceOf(DocumentInvalidError);
      expect((e as DocumentInvalidError).problems.join("; ")).toMatch(/id/);
    }
  });
});
