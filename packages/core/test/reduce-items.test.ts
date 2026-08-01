import { describe, expect, it } from "vitest";
import { createTierList } from "../src/factory";
import { reduce } from "../src/reduce";
import type { TierList } from "../src/types";

const NOW = "2026-07-31T12:00:00.000Z";
const S = "list-1-row-0";
const A = "list-1-row-1";

function withItems(ids: string[]): TierList {
  let doc = createTierList({ id: "list-1", now: NOW });
  for (const id of ids) {
    doc = reduce(doc, { type: "item/addText", id, label: id }, NOW);
  }
  return doc;
}

describe("item/addText and item/addImage", () => {
  it("adds the item to the tray, not to a row", () => {
    const doc = withItems(["i1"]);
    expect(doc.items[0]).toMatchObject({ id: "i1", kind: "text", order: 0 });
    expect(doc.placements[0]).toMatchObject({ itemId: "i1", rowId: null });
  });

  it("gives an image item its asset id and a default edit", () => {
    let doc = createTierList({ id: "list-1", now: NOW });
    doc = reduce(doc, { type: "item/addImage", id: "i1", assetId: "asset-9" }, NOW);
    expect(doc.items[0]).toMatchObject({ kind: "image", assetId: "asset-9" });
    expect(doc.items[0]!.edit.zoom).toBe(1);
  });

  it("assigns increasing order values", () => {
    const doc = withItems(["i1", "i2", "i3"]);
    expect(doc.items.map((i) => i.order)).toEqual([0, 1, 2]);
  });
});

describe("item/remove", () => {
  it("removes the item, its placement, and renumbers the remaining items", () => {
    const doc = reduce(withItems(["i1", "i2", "i3"]), { type: "item/remove", itemId: "i2" }, NOW);
    expect(doc.items.map((i) => i.id)).toEqual(["i1", "i3"]);
    expect(doc.items.map((i) => i.order)).toEqual([0, 1]);
    expect(doc.placements.find((p) => p.itemId === "i2")).toBeUndefined();
  });

  it("closes the gap in the row when a middle item is removed", () => {
    let doc = withItems(["i1", "i2", "i3"]);
    doc = reduce(doc, { type: "placement/place", itemId: "i1", rowId: S, index: 0 }, NOW);
    doc = reduce(doc, { type: "placement/place", itemId: "i2", rowId: S, index: 1 }, NOW);
    doc = reduce(doc, { type: "placement/place", itemId: "i3", rowId: S, index: 2 }, NOW);
    doc = reduce(doc, { type: "item/remove", itemId: "i2" }, NOW);

    const inS = doc.placements
      .filter((p) => p.rowId === S)
      .sort((a, b) => a.index - b.index);
    expect(inS.map((p) => p.itemId)).toEqual(["i1", "i3"]);
    expect(inS.map((p) => p.index)).toEqual([0, 1]);
  });

  it("closes the gap in the tray when a middle item is removed", () => {
    const doc = reduce(withItems(["i1", "i2", "i3"]), { type: "item/remove", itemId: "i2" }, NOW);

    const tray = doc.placements
      .filter((p) => p.rowId === null)
      .sort((a, b) => a.index - b.index);
    expect(tray.map((p) => p.itemId)).toEqual(["i1", "i3"]);
    expect(tray.map((p) => p.index)).toEqual([0, 1]);
  });

  it("removes an item that has no placement at all", () => {
    // Reachable: migrate() casts an untrusted document through without
    // checking that every item has a placement, so a loaded document can
    // hold one. Removing it must not disturb the placements that do exist.
    const base = withItems(["i1", "i2"]);
    const doc: TierList = {
      ...base,
      items: [...base.items, { ...base.items[0]!, id: "orphan", order: 2 }],
    };
    const next = reduce(doc, { type: "item/remove", itemId: "orphan" }, NOW);

    expect(next.items.map((i) => i.id)).toEqual(["i1", "i2"]);
    const tray = next.placements
      .filter((p) => p.rowId === null)
      .sort((a, b) => a.index - b.index);
    expect(tray.map((p) => p.itemId)).toEqual(["i1", "i2"]);
    expect(tray.map((p) => p.index)).toEqual([0, 1]);
  });
});

describe("item/setEdit", () => {
  it("replaces the edit for the target item only", () => {
    let doc = withItems(["i1", "i2"]);
    doc = reduce(
      doc,
      {
        type: "item/setEdit",
        itemId: "i1",
        edit: {
          crop: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 },
          rotation: 90,
          zoom: 2,
          offset: { x: 0.2, y: 0 },
          strokes: [{ id: "s1", points: [0, 0, 1, 1], color: "#fff", width: 4 }],
        },
      },
      NOW,
    );
    expect(doc.items[0]!.edit.rotation).toBe(90);
    expect(doc.items[0]!.edit.strokes).toHaveLength(1);
    expect(doc.items[1]!.edit.rotation).toBe(0);
  });
});

describe("placement/place", () => {
  it("places an item into a row at the requested index", () => {
    let doc = withItems(["i1"]);
    doc = reduce(doc, { type: "placement/place", itemId: "i1", rowId: S, index: 0 }, NOW);
    expect(doc.placements).toEqual([{ itemId: "i1", rowId: S, index: 0 }]);
  });

  it("shifts existing items to make room and keeps indices contiguous", () => {
    let doc = withItems(["i1", "i2", "i3"]);
    doc = reduce(doc, { type: "placement/place", itemId: "i1", rowId: S, index: 0 }, NOW);
    doc = reduce(doc, { type: "placement/place", itemId: "i2", rowId: S, index: 1 }, NOW);
    doc = reduce(doc, { type: "placement/place", itemId: "i3", rowId: S, index: 1 }, NOW);

    const inS = doc.placements
      .filter((p) => p.rowId === S)
      .sort((a, b) => a.index - b.index);
    expect(inS.map((p) => p.itemId)).toEqual(["i1", "i3", "i2"]);
    expect(inS.map((p) => p.index)).toEqual([0, 1, 2]);
  });

  it("moves an item between rows without duplicating it", () => {
    let doc = withItems(["i1"]);
    doc = reduce(doc, { type: "placement/place", itemId: "i1", rowId: S, index: 0 }, NOW);
    doc = reduce(doc, { type: "placement/place", itemId: "i1", rowId: A, index: 0 }, NOW);

    expect(doc.placements.filter((p) => p.itemId === "i1")).toHaveLength(1);
    expect(doc.placements[0]).toMatchObject({ rowId: A, index: 0 });
  });

  it("treats placing an item where it already is as a no-op", () => {
    let doc = withItems(["i1", "i2", "i3"]);
    doc = reduce(doc, { type: "placement/place", itemId: "i2", rowId: S, index: 0 }, NOW);
    const same = reduce(doc, { type: "placement/place", itemId: "i2", rowId: S, index: 0 }, NOW);
    expect(same).toBe(doc);
  });

  it("treats an out-of-range index that clamps onto the current slot as a no-op", () => {
    let doc = withItems(["i1", "i2"]);
    doc = reduce(doc, { type: "placement/place", itemId: "i1", rowId: S, index: 0 }, NOW);
    // i1 is alone in S, so any index past the end clamps back onto where it is.
    const same = reduce(doc, { type: "placement/place", itemId: "i1", rowId: S, index: 99 }, NOW);
    expect(same).toBe(doc);
  });

  it("still reorders when asked for a different slot in the same row", () => {
    let doc = withItems(["i1", "i2", "i3"]);
    doc = reduce(doc, { type: "placement/place", itemId: "i1", rowId: S, index: 0 }, NOW);
    doc = reduce(doc, { type: "placement/place", itemId: "i2", rowId: S, index: 1 }, NOW);
    const before = doc;
    doc = reduce(doc, { type: "placement/place", itemId: "i1", rowId: S, index: 1 }, NOW);

    expect(doc).not.toBe(before);
    expect(doc.revision).toBe(before.revision + 1);
    const inS = doc.placements
      .filter((p) => p.rowId === S)
      .sort((a, b) => a.index - b.index);
    expect(inS.map((p) => p.itemId)).toEqual(["i2", "i1"]);
    expect(inS.map((p) => p.index)).toEqual([0, 1]);
  });

  it("clamps an out-of-range index to the end of the row", () => {
    let doc = withItems(["i1", "i2"]);
    doc = reduce(doc, { type: "placement/place", itemId: "i1", rowId: S, index: 0 }, NOW);
    doc = reduce(doc, { type: "placement/place", itemId: "i2", rowId: S, index: 99 }, NOW);

    const inS = doc.placements
      .filter((p) => p.rowId === S)
      .sort((a, b) => a.index - b.index);
    expect(inS.map((p) => p.itemId)).toEqual(["i1", "i2"]);
  });
});

describe("placement/unplace", () => {
  it("returns the item to the tray and closes the gap behind it", () => {
    let doc = withItems(["i1", "i2", "i3"]);
    doc = reduce(doc, { type: "placement/place", itemId: "i1", rowId: S, index: 0 }, NOW);
    doc = reduce(doc, { type: "placement/place", itemId: "i2", rowId: S, index: 1 }, NOW);
    doc = reduce(doc, { type: "placement/place", itemId: "i3", rowId: S, index: 2 }, NOW);
    doc = reduce(doc, { type: "placement/unplace", itemId: "i2" }, NOW);

    const inS = doc.placements
      .filter((p) => p.rowId === S)
      .sort((a, b) => a.index - b.index);
    expect(inS.map((p) => p.itemId)).toEqual(["i1", "i3"]);
    expect(inS.map((p) => p.index)).toEqual([0, 1]);
    expect(doc.placements.find((p) => p.itemId === "i2")).toMatchObject({ rowId: null });
  });
});

describe("the tray is an ordered location", () => {
  it("appends new items to the end of the tray instead of stacking them at 0", () => {
    const doc = withItems(["i1", "i2", "i3"]);
    const tray = doc.placements
      .filter((p) => p.rowId === null)
      .sort((a, b) => a.index - b.index);
    expect(tray.map((p) => p.itemId)).toEqual(["i1", "i2", "i3"]);
    expect(tray.map((p) => p.index)).toEqual([0, 1, 2]);
  });

  it("places an item at a chosen index inside the tray", () => {
    let doc = withItems(["i1", "i2", "i3"]);
    doc = reduce(doc, { type: "placement/place", itemId: "i3", rowId: null, index: 0 }, NOW);

    const tray = doc.placements
      .filter((p) => p.rowId === null)
      .sort((a, b) => a.index - b.index);
    expect(tray.map((p) => p.itemId)).toEqual(["i3", "i1", "i2"]);
    expect(tray.map((p) => p.index)).toEqual([0, 1, 2]);
  });

  it("returns an unplaced item to the end of the tray, not the front", () => {
    let doc = withItems(["i1", "i2", "i3"]);
    doc = reduce(doc, { type: "placement/place", itemId: "i2", rowId: S, index: 0 }, NOW);
    doc = reduce(doc, { type: "placement/unplace", itemId: "i2" }, NOW);

    const tray = doc.placements
      .filter((p) => p.rowId === null)
      .sort((a, b) => a.index - b.index);
    expect(tray.map((p) => p.itemId)).toEqual(["i1", "i3", "i2"]);
    expect(tray.map((p) => p.index)).toEqual([0, 1, 2]);
  });

  it("moves an item from a row into a chosen tray index, closing the row gap", () => {
    let doc = withItems(["i1", "i2", "i3", "i4"]);
    doc = reduce(doc, { type: "placement/place", itemId: "i2", rowId: S, index: 0 }, NOW);
    doc = reduce(doc, { type: "placement/place", itemId: "i3", rowId: S, index: 1 }, NOW);
    // Tray is now [i1, i4]; bring i2 back to the front of it, not the end.
    doc = reduce(doc, { type: "placement/place", itemId: "i2", rowId: null, index: 0 }, NOW);

    const tray = doc.placements
      .filter((p) => p.rowId === null)
      .sort((a, b) => a.index - b.index);
    expect(tray.map((p) => p.itemId)).toEqual(["i2", "i1", "i4"]);
    expect(tray.map((p) => p.index)).toEqual([0, 1, 2]);

    const inS = doc.placements
      .filter((p) => p.rowId === S)
      .sort((a, b) => a.index - b.index);
    expect(inS.map((p) => p.itemId)).toEqual(["i3"]);
    expect(inS.map((p) => p.index)).toEqual([0]);
  });

  it("treats unplacing an item already in the tray as a no-op", () => {
    const doc = withItems(["i1"]);
    expect(reduce(doc, { type: "placement/unplace", itemId: "i1" }, NOW)).toBe(doc);
  });

  it("keeps tray indices contiguous when an item is dragged out of it", () => {
    let doc = withItems(["i1", "i2", "i3"]);
    doc = reduce(doc, { type: "placement/place", itemId: "i2", rowId: S, index: 0 }, NOW);

    const tray = doc.placements
      .filter((p) => p.rowId === null)
      .sort((a, b) => a.index - b.index);
    expect(tray.map((p) => p.itemId)).toEqual(["i1", "i3"]);
    expect(tray.map((p) => p.index)).toEqual([0, 1]);
  });

  it("closes the gap in the source row when an item moves to another row", () => {
    let doc = withItems(["i1", "i2", "i3"]);
    doc = reduce(doc, { type: "placement/place", itemId: "i1", rowId: S, index: 0 }, NOW);
    doc = reduce(doc, { type: "placement/place", itemId: "i2", rowId: S, index: 1 }, NOW);
    doc = reduce(doc, { type: "placement/place", itemId: "i3", rowId: S, index: 2 }, NOW);
    doc = reduce(doc, { type: "placement/place", itemId: "i1", rowId: A, index: 0 }, NOW);

    const inS = doc.placements
      .filter((p) => p.rowId === S)
      .sort((a, b) => a.index - b.index);
    expect(inS.map((p) => p.itemId)).toEqual(["i2", "i3"]);
    expect(inS.map((p) => p.index)).toEqual([0, 1]);
  });
});

describe("display/set and meta/set", () => {
  it("patches display settings without clearing the others", () => {
    const doc = reduce(withItems([]), { type: "display/set", patch: { tileSize: 160 } }, NOW);
    expect(doc.display.tileSize).toBe(160);
    expect(doc.display.showLabels).toBe(true);
  });

  it("patches metadata", () => {
    const doc = reduce(
      withItems([]),
      { type: "meta/set", patch: { title: "Ramen", tags: ["food"] } },
      NOW,
    );
    expect(doc.title).toBe("Ramen");
    expect(doc.tags).toEqual(["food"]);
    expect(doc.description).toBe("");
  });
});
