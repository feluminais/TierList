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

  // The anchor above sits at HALF's own centre, so an implementation that
  // dropped the anchor and simply re-centred the result would pass that test
  // too. This anchor is well away from the crop's centre (0.4, 0.5), so
  // centring and anchoring diverge and only genuine anchor-tracking survives.
  it("keeps an off-centre anchor point fixed, not just the crop's centre", () => {
    const crop: Crop = { x: 0.2, y: 0.3, w: 0.4, h: 0.4 };
    const anchor = { x: 0.25, y: 0.35 };
    const zoomed = zoomCrop(crop, 2, anchor);
    const fractionX = (anchor.x - crop.x) / crop.w;
    const fractionY = (anchor.y - crop.y) / crop.h;
    expect(zoomed.x + fractionX * zoomed.w).toBeCloseTo(anchor.x, 10);
    expect(zoomed.y + fractionY * zoomed.h).toBeCloseTo(anchor.y, 10);
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

  // The test above only asserts w > 0, which a floor-less implementation
  // would also satisfy for any finite factor (crop.w / factor never reaches
  // exactly zero) — pinning the actual floor value is what would catch a
  // MIN_CROP that was accidentally set to 0 or otherwise disabled.
  it("shrinks no further than the 0.02 floor for an extreme zoom-in", () => {
    const tiny = zoomCrop(HALF, 1e6, { x: 0.5, y: 0.5 });
    expect(tiny.w).toBeCloseTo(0.02, 10);
    expect(tiny.h).toBeCloseTo(0.02, 10);
  });

  it("treats a factor of 1 as a no-op", () => {
    expect(zoomCrop(HALF, 1, { x: 0.5, y: 0.5 })).toEqual(HALF);
  });

  // A crop whose own aspect ratio is far from 1 (much wider than tall, or
  // much taller than wide) is reachable only through a hand-edited or
  // corrupted document, since every aspect `defaultCropFor` can produce
  // (0.75, 1, 1.33) is nowhere near this extreme. An implementation that
  // clamps w and derives h from it (or vice versa) can let the *derived*
  // axis run past its own bound — the derivation is a division that inherits
  // none of the clamp just applied to the other axis. These pin both
  // invariants (stays inside 0..1, keeps the source aspect) for exactly the
  // shapes that broke that approach.
  it("stays inside the source when zooming in on a very wide crop", () => {
    const wide: Crop = { x: 0, y: 0.4, w: 0.9, h: 0.01 }; // aspect ~0.011, below MIN_CROP
    const zoomed = zoomCrop(wide, 5, { x: 0.45, y: 0.405 });
    expect(zoomed.x).toBeGreaterThanOrEqual(0);
    expect(zoomed.y).toBeGreaterThanOrEqual(0);
    expect(zoomed.x + zoomed.w).toBeLessThanOrEqual(1);
    expect(zoomed.y + zoomed.h).toBeLessThanOrEqual(1);
    expect(zoomed.h / zoomed.w).toBeCloseTo(wide.h / wide.w, 6);
  });

  it("stays inside the source when zooming in on a very tall crop", () => {
    const tall: Crop = { x: 0.4, y: 0, w: 0.01, h: 0.9 }; // aspect ~90, above 1/MIN_CROP
    const zoomed = zoomCrop(tall, 5, { x: 0.405, y: 0.45 });
    expect(zoomed.x).toBeGreaterThanOrEqual(0);
    expect(zoomed.y).toBeGreaterThanOrEqual(0);
    expect(zoomed.x + zoomed.w).toBeLessThanOrEqual(1);
    expect(zoomed.y + zoomed.h).toBeLessThanOrEqual(1);
    expect(zoomed.h / zoomed.w).toBeCloseTo(tall.h / tall.w, 6);
  });

  it("never lets width fall below MIN_CROP for a very tall crop, even where that means the aspect gives way", () => {
    // Aspect 200 cannot fit both axes inside [MIN_CROP, 1] at any scale
    // (1 / 200 < MIN_CROP), so respecting the floor on w is the only way to
    // avoid a width of ~0. Staying inside the source and above the floor
    // wins over the aspect lock in this unreachable-in-practice case.
    const extreme: Crop = { x: 0.49, y: 0, w: 0.005, h: 1 };
    const zoomed = zoomCrop(extreme, 0.5, { x: 0.4925, y: 0.5 });
    expect(zoomed.w).toBeGreaterThan(0);
    expect(zoomed.h).toBeGreaterThan(0);
    expect(zoomed.x).toBeGreaterThanOrEqual(0);
    expect(zoomed.y).toBeGreaterThanOrEqual(0);
    expect(zoomed.x + zoomed.w).toBeLessThanOrEqual(1);
    expect(zoomed.y + zoomed.h).toBeLessThanOrEqual(1);
  });
});
