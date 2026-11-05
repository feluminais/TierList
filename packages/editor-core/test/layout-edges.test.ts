import {
  createTierList,
  reduce,
  type Density,
  type TierList,
  type TileAspect,
} from "@tl/core";
import { describe, expect, it } from "vitest";
import { dropTargetAt, hitTest } from "../src/hit";
import {
  aspectRatioFor,
  layoutBoard,
  MIN_LABEL_WIDTH,
  MIN_TILE_SIZE,
  type BoardLayout,
} from "../src/layout";
import { contains } from "../src/geometry";
import type { Rect } from "../src/geometry";

const NOW = "2026-08-01T12:00:00.000Z";

/**
 * A list with items spread over two tiers and the tray, so every kind of
 * location holds tiles. Built with non-default display settings, because a
 * default document cannot tell a transposed width from a height.
 */
function sample(options: {
  tileSize: number;
  tileAspect: TileAspect;
  labelWidth: number;
  density: Density;
  override?: number;
}): TierList {
  let doc = createTierList({ id: "list-1", now: NOW });
  doc = reduce(
    doc,
    {
      type: "display/set",
      patch: {
        tileSize: options.tileSize,
        tileAspect: options.tileAspect,
        labelWidth: options.labelWidth,
        density: options.density,
      },
    },
    NOW,
  );
  for (let i = 0; i < 9; i += 1) {
    doc = reduce(doc, { type: "item/addText", id: `i${i}`, label: `i${i}` }, NOW);
  }
  const [first, second] = doc.rows;
  for (let i = 0; i < 3; i += 1) {
    doc = reduce(doc, { type: "placement/place", itemId: `i${i}`, rowId: first!.id, index: i }, NOW);
  }
  for (let i = 3; i < 5; i += 1) {
    doc = reduce(doc, { type: "placement/place", itemId: `i${i}`, rowId: second!.id, index: i - 3 }, NOW);
  }
  if (options.override !== undefined) {
    doc = reduce(doc, { type: "row/setTileSize", rowId: first!.id, tileSize: options.override }, NOW);
  }
  return doc;
}

const inside = (inner: Rect, outer: Rect) =>
  inner.x >= outer.x &&
  inner.y >= outer.y &&
  inner.x + inner.width <= outer.x + outer.width &&
  inner.y + inner.height <= outer.y + outer.height;

function everyTile(layout: BoardLayout) {
  return [
    ...layout.rows.flatMap((row) => row.tiles.map((tile) => ({ tile, area: row.tilesRect, row: row.rect }))),
    ...layout.tray.tiles.map((tile) => ({ tile, area: layout.tray.tilesRect, row: layout.tray.rect })),
  ];
}

const ASPECTS: TileAspect[] = ["square", "portrait", "landscape"];
const DENSITIES: Density[] = ["compact", "normal", "roomy"];

describe("a tile never overflows the area it is laid into", () => {
  it("holds at every width, tile size, aspect, density and label width", () => {
    let checked = 0;
    for (let width = 0; width <= 700; width += 11) {
      for (const tileSize of [48, 96, 240]) {
        for (const tileAspect of ASPECTS) {
          for (const density of DENSITIES) {
            for (const labelWidth of [56, 120, 320]) {
              const doc = sample({ tileSize, tileAspect, labelWidth, density, override: 200 });
              const layout = layoutBoard(doc, { width, trayAddSlot: true });
              for (const { tile, area } of everyTile(layout)) {
                const where = JSON.stringify({ width, tileSize, tileAspect, density, labelWidth });
                expect(inside(tile.rect, area), where).toBe(true);
                expect(tile.rect.width, where).toBeGreaterThanOrEqual(0);
                expect(tile.rect.height, where).toBeGreaterThanOrEqual(0);
                expect(Number.isFinite(tile.rect.width + tile.rect.height), where).toBe(true);
                checked += 1;
              }
              if (layout.tray.addSlot) expect(inside(layout.tray.addSlot, layout.tray.tilesRect)).toBe(true);
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(10_000);
  });

  it("keeps a shrunken tile's aspect ratio", () => {
    const doc = sample({ tileSize: 96, tileAspect: "portrait", labelWidth: 120, density: "normal" });
    const layout = layoutBoard(doc, { width: 90 });
    const tile = layout.rows[0]!.tiles[0]!.rect;
    expect(tile.width).toBeGreaterThan(0);
    expect(tile.height / tile.width).toBeCloseTo(aspectRatioFor("portrait"), 1);
  });

  it("leaves a tile that already fits exactly as it was", () => {
    const doc = sample({ tileSize: 96, tileAspect: "portrait", labelWidth: 120, density: "normal" });
    const tile = layoutBoard(doc, { width: 800 }).rows[0]!.tiles[0]!.rect;
    expect(tile.width).toBe(96);
    expect(tile.height).toBe(128);
  });

  it("makes hit testing and drop targeting agree about every tile", () => {
    for (let width = 30; width <= 400; width += 13) {
      for (const tileAspect of ASPECTS) {
        const doc = sample({ tileSize: 120, tileAspect, labelWidth: 200, density: "roomy" });
        const layout = layoutBoard(doc, { width });
        for (const { tile } of everyTile(layout)) {
          if (tile.rect.width < 1 || tile.rect.height < 1) continue;
          const centre = {
            x: tile.rect.x + tile.rect.width / 2,
            y: tile.rect.y + tile.rect.height / 2,
          };
          expect(hitTest(layout, centre)).toMatchObject({ kind: "tile", itemId: tile.itemId });
          // Dragging any other item over a tile the pointer can hit has somewhere to land.
          expect(dropTargetAt(layout, centre, "not-this-one"), `width ${width}`).not.toBeNull();
        }
      }
    }
  });
});

describe("layoutBoard with responsive on", () => {
  const phone = (extra: object = {}) =>
    sample({ tileSize: 96, tileAspect: "portrait", labelWidth: 120, density: "normal", ...extra });

  // The first tier, which holds three tiles: how many sit on its first line.
  const tilesPerLine = (layout: BoardLayout) => {
    const tiles = layout.rows[0]!.tiles;
    const firstY = tiles[0]!.rect.y;
    return tiles.filter((t) => t.rect.y === firstY).length;
  };

  it("fits at least three tiles on a line at phone width, where the document's sizes give two", () => {
    const doc = phone();
    expect(tilesPerLine(layoutBoard(doc, { width: 343 }))).toBe(2);
    expect(tilesPerLine(layoutBoard(doc, { width: 343, responsive: true }))).toBeGreaterThanOrEqual(3);
  });

  it("narrows the label column and shrinks tiles, and never grows either", () => {
    const doc = phone();
    const plain = layoutBoard(doc, { width: 343 });
    const fitted = layoutBoard(doc, { width: 343, responsive: true });
    expect(fitted.rows[0]!.labelRect.width).toBeLessThan(plain.rows[0]!.labelRect.width);
    expect(fitted.rows[0]!.labelRect.width).toBeGreaterThanOrEqual(MIN_LABEL_WIDTH);
    expect(fitted.rows[0]!.tiles[0]!.rect.width).toBeLessThan(plain.rows[0]!.tiles[0]!.rect.width);
  });

  it("keeps each tile's aspect and never drops below the smallest tile size", () => {
    const fitted = layoutBoard(phone({ tileSize: 240 }), { width: 343, responsive: true });
    const tile = fitted.rows[1]!.tiles[0]!.rect;
    expect(tile.width).toBeGreaterThanOrEqual(MIN_TILE_SIZE);
    expect(tile.height / tile.width).toBeCloseTo(aspectRatioFor("portrait"), 1);
  });

  it("is the same layout as without it once the board is wide enough", () => {
    for (const width of [640, 800, 1280]) {
      const doc = phone();
      expect(layoutBoard(doc, { width, responsive: true })).toEqual(layoutBoard(doc, { width }));
    }
  });

  it("scales a tier's own tile size by the same factor, so tiers keep their proportions", () => {
    const doc = phone({ override: 144 });
    const plain = layoutBoard(doc, { width: 343 });
    const fitted = layoutBoard(doc, { width: 343, responsive: true });
    const plainRatio = plain.rows[0]!.tiles[0]!.rect.width / plain.rows[1]!.tiles[0]!.rect.width;
    const fittedRatio = fitted.rows[0]!.tiles[0]!.rect.width / fitted.rows[1]!.tiles[0]!.rect.width;
    expect(fittedRatio).toBeCloseTo(plainRatio, 1);
  });

  it("never shrinks tiles as the board widens", () => {
    const doc = phone();
    let previous = 0;
    for (let width = 100; width <= 900; width += 7) {
      const tile = layoutBoard(doc, { width, responsive: true }).rows[0]!.tiles[0]!.rect;
      expect(tile.width, `width ${width}`).toBeGreaterThanOrEqual(previous);
      previous = tile.width;
    }
  });

  it("does not touch the document", () => {
    const doc = phone();
    const before = JSON.stringify(doc);
    layoutBoard(doc, { width: 343, responsive: true });
    expect(JSON.stringify(doc)).toBe(before);
  });

  it("keeps every tile inside its area and consistent with hit testing", () => {
    for (let width = 60; width <= 700; width += 17) {
      const layout = layoutBoard(phone({ override: 200 }), { width, responsive: true });
      for (const { tile, area } of everyTile(layout)) {
        expect(inside(tile.rect, area), `width ${width}`).toBe(true);
        if (tile.rect.width >= 1 && tile.rect.height >= 1) {
          expect(contains(tile.rect, { x: tile.rect.x, y: tile.rect.y })).toBe(true);
        }
      }
    }
  });
});
