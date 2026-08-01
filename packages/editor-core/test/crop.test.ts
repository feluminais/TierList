import { describe, expect, it } from "vitest";
import { panCrop, zoomCrop, type Crop } from "../src/crop";

const FULL: Crop = { x: 0, y: 0, w: 1, h: 1 };
const HALF: Crop = { x: 0.25, y: 0.25, w: 0.5, h: 0.5 };

describe("panCrop", () => {
  it("moves the crop by the requested amount", () => {
    expect(panCrop(HALF, { x: 0.1, y: -0.1 })).toEqual({
      x: 0.35,
      y: 0.15,
      w: 0.5,
      h: 0.5,
    });
  });

  it("stops at the left and top edges rather than going negative", () => {
    expect(panCrop(HALF, { x: -1, y: -1 })).toEqual({ x: 0, y: 0, w: 0.5, h: 0.5 });
  });

  it("stops at the right and bottom edges", () => {
    expect(panCrop(HALF, { x: 1, y: 1 })).toEqual({ x: 0.5, y: 0.5, w: 0.5, h: 0.5 });
  });

  it("cannot move a full-size crop at all", () => {
    expect(panCrop(FULL, { x: 0.5, y: 0.5 })).toEqual(FULL);
  });

  it("never changes the crop's size", () => {
    for (const delta of [
      { x: 0, y: 0 },
      { x: 5, y: -5 },
      { x: -0.3, y: 0.2 },
    ]) {
      const moved = panCrop(HALF, delta);
      expect(moved.w).toBe(HALF.w);
      expect(moved.h).toBe(HALF.h);
    }
  });
});

describe("zoomCrop", () => {
  // factor > 1 zooms *in*, which makes the crop rectangle smaller — the
  // direction is worth pinning because it is the obvious thing to get backwards.
  it("zooming in shrinks the crop", () => {
    const zoomed = zoomCrop(HALF, 2, { x: 0.5, y: 0.5 });
    expect(zoomed.w).toBeCloseTo(0.25, 10);
    expect(zoomed.h).toBeCloseTo(0.25, 10);
  });

  it("zooming out grows the crop", () => {
    const zoomed = zoomCrop(HALF, 0.5, { x: 0.5, y: 0.5 });
    expect(zoomed.w).toBeCloseTo(1, 10);
    expect(zoomed.h).toBeCloseTo(1, 10);
  });

  it("keeps the anchor point fixed in source coordinates", () => {
    const anchor = { x: 0.5, y: 0.5 };
    const zoomed = zoomCrop(HALF, 2, anchor);
    // The anchor sat at the centre of HALF, so it must still be at the centre.
    expect(zoomed.x + zoomed.w / 2).toBeCloseTo(anchor.x, 10);
    expect(zoomed.y + zoomed.h / 2).toBeCloseTo(anchor.y, 10);
  });

  it("cannot zoom out past the whole source", () => {
    const zoomed = zoomCrop(HALF, 0.01, { x: 0.5, y: 0.5 });
    expect(zoomed).toEqual(FULL);
  });

  it("stays inside the source when zooming out near an edge", () => {
    const corner: Crop = { x: 0, y: 0, w: 0.5, h: 0.5 };
    const zoomed = zoomCrop(corner, 0.5, { x: 0, y: 0 });
    expect(zoomed.x).toBeGreaterThanOrEqual(0);
    expect(zoomed.y).toBeGreaterThanOrEqual(0);
    expect(zoomed.x + zoomed.w).toBeLessThanOrEqual(1);
    expect(zoomed.y + zoomed.h).toBeLessThanOrEqual(1);
  });

  it("preserves the aspect ratio through any zoom", () => {
    const start: Crop = { x: 0.1, y: 0.1, w: 0.6, h: 0.3 };
    const ratio = start.h / start.w;
    for (const factor of [0.3, 0.9, 1, 1.1, 4]) {
      const zoomed = zoomCrop(start, factor, { x: 0.4, y: 0.25 });
      expect(zoomed.h / zoomed.w).toBeCloseTo(ratio, 6);
    }
  });

  it("refuses to shrink below a usable floor", () => {
    const tiny = zoomCrop(HALF, 1e6, { x: 0.5, y: 0.5 });
    expect(tiny.w).toBeGreaterThan(0);
    expect(tiny.h).toBeGreaterThan(0);
  });

  it("treats a factor of 1 as a no-op", () => {
    expect(zoomCrop(HALF, 1, { x: 0.5, y: 0.5 })).toEqual(HALF);
  });
});
