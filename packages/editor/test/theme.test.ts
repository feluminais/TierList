import type { Item } from "@tl/core";
import { describe, expect, it } from "vitest";
import {
  rowFontSize,
  tileFill,
  tileFontSize,
  TILE_PENDING,
  TILE_TEXT_FILL,
  truncate,
} from "../src/theme";

function item(kind: Item["kind"]): Item {
  return {
    id: "i1",
    kind,
    label: "x",
    edit: { crop: { x: 0, y: 0, w: 1, h: 1 }, rotation: 0, zoom: 1, offset: { x: 0, y: 0 }, strokes: [] },
    order: 0,
  };
}

describe("tileFill", () => {
  it("marks an image tile as pending, because object storage does not exist yet", () => {
    expect(tileFill(item("image"))).toBe(TILE_PENDING);
  });

  it("fills a text tile differently, so the two are distinguishable", () => {
    expect(tileFill(item("text"))).toBe(TILE_TEXT_FILL);
    expect(tileFill(item("text"))).not.toBe(tileFill(item("image")));
  });
});

describe("truncate", () => {
  it("leaves a label that fits alone", () => {
    expect(truncate("Ramen", 96, 13)).toBe("Ramen");
  });

  it("clips an over-long label and marks it as clipped", () => {
    const out = truncate("a".repeat(200), 96, 13);
    expect(out.length).toBeLessThan(200);
    expect(out.endsWith("…")).toBe(true);
  });

  it("never returns an empty string, however small the tile", () => {
    expect(truncate("Ramen", 1, 40).length).toBeGreaterThan(0);
  });

  it("keeps more characters on a wider tile", () => {
    const narrow = truncate("a".repeat(100), 60, 13);
    const wide = truncate("a".repeat(100), 200, 13);
    expect(wide.length).toBeGreaterThan(narrow.length);
  });

  it("is stable — truncating an already-truncated label changes nothing", () => {
    const once = truncate("a".repeat(100), 96, 13);
    expect(truncate(once, 96, 13)).toBe(once);
  });
});

describe("font sizes", () => {
  it("keeps a tile label legible on a small tile and bounded on a large one", () => {
    expect(tileFontSize(24)).toBeGreaterThanOrEqual(9);
    expect(tileFontSize(1000)).toBeLessThanOrEqual(16);
  });

  it("grows a tile label with the tile", () => {
    expect(tileFontSize(200)).toBeGreaterThan(tileFontSize(50));
  });

  it("fits a row label inside both the label column and the row height", () => {
    expect(rowFontSize(120, 108)).toBeLessThanOrEqual(120 / 3);
    expect(rowFontSize(120, 30)).toBeLessThanOrEqual(30 / 2.5 + 12);
  });

  it("keeps a row label readable even in a cramped row", () => {
    expect(rowFontSize(10, 10)).toBeGreaterThanOrEqual(12);
  });
});
