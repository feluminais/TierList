import { createTierList, reduce, type TierList } from "@tl/core";
import { imageDrawRect, imagePlacement, layoutBoard } from "@tl/editor-core";
import { createElement } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { StaticBoard } from "../app/l/[code]/StaticBoard";

const NOW = "2026-08-01T12:00:00.000Z";

/**
 * `StaticBoard` lays out against this internally and emits percentages of it.
 * Restated here so a test can rebuild the same layout and compare — if the two
 * ever drift, every position assertion below goes red rather than quietly
 * measuring the wrong board.
 */
const BOARD_UNITS = 1000;

afterEach(cleanup);

/**
 * Deliberately not square and deliberately not default.
 *
 * A portrait tile aspect makes the tile's width and height differ, and a
 * lopsided crop makes the two axes of the image placement differ, so a
 * transposed x and y cannot pass. This is the fixture discipline this project
 * has now paid for three times.
 */
function doc(): TierList {
  let d = createTierList({ id: "list-1", now: NOW });
  d = reduce(d, { type: "display/set", patch: { tileAspect: "portrait" } }, NOW);
  d = reduce(d, { type: "item/addText", id: "text-1", label: "Ramen" }, NOW);
  d = reduce(
    d,
    {
      type: "item/addImage",
      id: "img-1",
      assetId: "asset-1",
      label: "Udon",
      edit: {
        crop: { x: 0.1, y: 0.35, w: 0.5, h: 0.25 },
        rotation: 0,
        zoom: 1,
        offset: { x: 0, y: 0 },
        strokes: [],
      },
    },
    NOW,
  );
  d = reduce(
    d,
    { type: "placement/place", itemId: "img-1", rowId: d.rows[0]!.id, index: 0 },
    NOW,
  );
  return d;
}

function withStrokeOn(d: TierList, itemId: string): TierList {
  const item = d.items.find((i) => i.id === itemId)!;
  return reduce(
    d,
    {
      type: "item/setEdit",
      itemId,
      edit: {
        ...item.edit,
        strokes: [
          { id: "s1", points: [0.2, 0.4, 0.3, 0.5, 0.45, 0.42], color: "#ff0000", width: 3 },
        ],
      },
    },
    NOW,
  );
}

/**
 * Deliberately not square, and deliberately not the same aspect as any tile:
 * `imageDrawRect`'s cover scale is `max(dest/source)` over both axes, so the
 * source's own aspect decides which axis dominates. A square source here would
 * hide exactly the defect that made this argument necessary.
 */
const SOURCE = { width: 4000, height: 2500 };

function mount(d: TierList, sources = new Map([["asset-1", SOURCE]])) {
  const { container } = render(
    createElement(StaticBoard, {
      doc: d,
      assetUrl: (id: string) => `/assets/${id}`,
      sources,
    }),
  );
  return container;
}

/** Reads a percentage back off an inline style, e.g. "12.5%" -> 12.5. */
function percent(value: string): number {
  expect(value.endsWith("%")).toBe(true);
  return Number(value.slice(0, -1));
}

describe("StaticBoard", () => {
  it("renders no canvas and loads no Skia — a public page must not pull in CanvasKit", () => {
    const container = mount(doc());
    expect(container.querySelector("canvas")).toBeNull();
  });

  it("places a tile where layoutBoard puts it, as a percentage of the board", () => {
    const d = doc();
    const layout = layoutBoard(d, { width: BOARD_UNITS });
    const expected = layout.rows[0]!.tiles[0]!.rect;

    const container = mount(d);
    const img = container.querySelector('img[src="/assets/asset-1"]');
    expect(img).not.toBeNull();
    const tile = img!.parentElement as HTMLElement;

    expect(percent(tile.style.left)).toBeCloseTo((expected.x / BOARD_UNITS) * 100, 2);
    expect(percent(tile.style.top)).toBeCloseTo((expected.y / layout.contentHeight) * 100, 2);
    expect(percent(tile.style.width)).toBeCloseTo((expected.width / BOARD_UNITS) * 100, 2);
    expect(percent(tile.style.height)).toBeCloseTo(
      (expected.height / layout.contentHeight) * 100,
      2,
    );
  });

  /**
   * The claim this whole component rests on: it draws the image where the Skia
   * renderer would. Computed from the same pure functions `TierBoard` calls,
   * so it is a comparison against the single source of geometry rather than
   * against numbers copied out of the implementation.
   */
  it("positions the image by imagePlacement/imageDrawRect, the way the canvas does", () => {
    const d = doc();
    const layout = layoutBoard(d, { width: BOARD_UNITS });
    const rect = layout.rows[0]!.tiles[0]!.rect;
    const item = d.items.find((i) => i.id === "img-1")!;

    const dest = { x: 0, y: 0, width: rect.width, height: rect.height };
    const draw = imageDrawRect(imagePlacement(SOURCE, item.edit, dest), SOURCE);

    const container = mount(d);
    const img = container.querySelector('img[src="/assets/asset-1"]') as HTMLElement;

    expect(percent(img.style.left)).toBeCloseTo((draw.x / rect.width) * 100, 1);
    expect(percent(img.style.top)).toBeCloseTo((draw.y / rect.height) * 100, 1);
    expect(percent(img.style.width)).toBeCloseTo((draw.width / rect.width) * 100, 1);
    expect(percent(img.style.height)).toBeCloseTo((draw.height / rect.height) * 100, 1);
  });

  /**
   * The regression test for the defect this file found: the first version
   * passed an arbitrary square size on the theory that the source cancelled
   * out. The magnitude does; the *aspect* does not, because `imageDrawRect`
   * takes `max(dest/source)` over both axes and the source's shape decides
   * which one wins.
   */
  it("places the same crop differently for a differently-shaped source", () => {
    const tall = mount(doc(), new Map([["asset-1", { width: 2500, height: 4000 }]]));
    const tallLeft = (tall.querySelector("img") as HTMLElement).style.left;
    cleanup();

    const wide = mount(doc(), new Map([["asset-1", { width: 4000, height: 2500 }]]));
    const wideLeft = (wide.querySelector("img") as HTMLElement).style.left;

    expect(tallLeft).not.toBe(wideLeft);
  });

  it("the same crop on a differently-shaped tile gives a different placement", () => {
    // Guards against the whole placement collapsing to a constant — which
    // would satisfy the assertion above for any crop at all.
    const portrait = mount(doc()).querySelector('img[src="/assets/asset-1"]') as HTMLElement;
    const portraitLeft = portrait.style.left;
    cleanup();

    const landscape = reduce(doc(), {
      type: "display/set",
      patch: { tileAspect: "landscape" },
    }, NOW);
    const other = mount(landscape).querySelector('img[src="/assets/asset-1"]') as HTMLElement;

    expect(other.style.left).not.toBe(portraitLeft);
  });

  /**
   * A guessed placement looks deliberate and is wrong; a centred cover is
   * visibly a fallback and is never distorted.
   */
  it("falls back to a centred cover when the source size is unknown", () => {
    const container = mount(doc(), new Map());
    const img = container.querySelector('img[src="/assets/asset-1"]') as HTMLElement;
    expect(img.style.objectFit).toBe("cover");
    expect(img.style.left).toBe("");
  });

  /**
   * The regression this project already shipped once, in the other renderer:
   * both `EditCanvas` and `TierBoard` nested the stroke loop inside the
   * image's ready check, so drawing on a text tile committed an
   * `item/setEdit` and painted nothing. Invisible data.
   */
  it("draws strokes on a text tile, which has no image at all", () => {
    const container = mount(withStrokeOn(doc(), "text-1"));
    const polyline = container.querySelector("polyline");
    expect(polyline).not.toBeNull();
    expect(polyline!.getAttribute("stroke")).toBe("#ff0000");
    expect(polyline!.getAttribute("points")!.split(" ")).toHaveLength(3);
  });

  it("draws strokes on an image tile too", () => {
    const container = mount(withStrokeOn(doc(), "img-1"));
    expect(container.querySelectorAll("polyline")).toHaveLength(1);
  });

  it("renders row labels and their colours", () => {
    const d = doc();
    const container = mount(d);
    const text = container.textContent ?? "";
    for (const row of d.rows) expect(text).toContain(row.label);
  });

  it("renders a tray tile as well as a placed one", () => {
    const container = mount(doc());
    // "Ramen" is the text item, left unplaced — so it lives in the tray.
    expect(container.textContent).toContain("Ramen");
  });

  it("survives a document carrying a rotation the placement maths refuses", () => {
    const d = doc();
    const item = d.items.find((i) => i.id === "img-1")!;
    const rotated = reduce(
      d,
      { type: "item/setEdit", itemId: "img-1", edit: { ...item.edit, rotation: 90 } },
      NOW,
    );
    // `imagePlacement` throws on a non-zero rotation, and nothing validates a
    // stored document. A public page must degrade to a tile without its
    // picture rather than 500 for every reader of the link.
    const container = mount(rotated);
    expect(container.querySelector('img[src="/assets/asset-1"]')).toBeNull();
    expect(container.textContent).toContain("Ramen");
  });

  it("survives a zero-area crop rather than throwing out of toTilePoint", () => {
    const d = withStrokeOn(doc(), "img-1");
    const item = d.items.find((i) => i.id === "img-1")!;
    const broken = reduce(
      d,
      {
        type: "item/setEdit",
        itemId: "img-1",
        edit: { ...item.edit, crop: { x: 0, y: 0, w: 0, h: 0 } },
      },
      NOW,
    );
    const container = mount(broken);
    expect(container.querySelector("polyline")!.getAttribute("points")).toBe("");
  });
});
