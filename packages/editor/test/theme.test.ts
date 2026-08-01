import type { Item } from "@tl/core";
import { describe, expect, it } from "vitest";
import {
  rowFontSize,
  tileFill,
  tileFontSize,
  TILE_FAILED,
  TILE_LOADING,
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
  it("shows the loading colour for an image tile with no status yet", () => {
    // Optional `status` covers the drag-preview call site, which passes only
    // the item — a lifted tile shows its loading colour for the span of a drag.
    expect(tileFill(item("image"))).toBe(TILE_LOADING);
  });

  it("shows the loading colour while an image tile's bytes are still arriving", () => {
    expect(tileFill(item("image"), "loading")).toBe(TILE_LOADING);
  });

  it("shows the failed colour when an image tile's bytes could not be fetched or decoded", () => {
    expect(tileFill(item("image"), "failed")).toBe(TILE_FAILED);
  });

  // "Not here yet" and "not coming" are different things to tell someone, so
  // loading and failed must not share a colour.
  it("distinguishes loading from failed", () => {
    expect(tileFill(item("image"), "loading")).not.toBe(tileFill(item("image"), "failed"));
  });

  it("ignores status for a ready image tile, falling back to the loading colour behind it", () => {
    // `ready` covers the whole tile once an image is drawn on top; the fill
    // only shows through slivers a decoded image falls short of, so it need
    // not be a distinct colour of its own.
    expect(tileFill(item("image"), "ready")).toBe(TILE_LOADING);
  });

  it("fills a text tile differently, so the two are distinguishable", () => {
    expect(tileFill(item("text"))).toBe(TILE_TEXT_FILL);
    expect(tileFill(item("text"))).not.toBe(tileFill(item("image")));
  });

  it("ignores status entirely for a text tile", () => {
    expect(tileFill(item("text"), "failed")).toBe(TILE_TEXT_FILL);
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
