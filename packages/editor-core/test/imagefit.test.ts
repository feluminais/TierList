import { defaultImageEdit } from "@tl/core";
import type { ImageEdit } from "@tl/core";
import { describe, expect, it } from "vitest";
import { defaultCropFor, imagePlacement, type SourceSize } from "../src/imagefit";

const TILE = { x: 10, y: 20, width: 100, height: 100 };

function editWith(crop: ImageEdit["crop"]): ImageEdit {
  return { ...defaultImageEdit(), crop };
}

describe("defaultCropFor", () => {
  // A square tile over a landscape source: the crop is full height, and the
  // widest centred square that fits. Anything else would letterbox.
  it("takes the largest centred square from a landscape source", () => {
    expect(defaultCropFor({ width: 200, height: 100 }, 1)).toEqual({
      x: 0.25,
      y: 0,
      w: 0.5,
      h: 1,
    });
  });

  it("takes the largest centred square from a portrait source", () => {
    expect(defaultCropFor({ width: 100, height: 200 }, 1)).toEqual({
      x: 0,
      y: 0.25,
      w: 1,
      h: 0.5,
    });
  });

  it("uses the whole source when the aspects already match", () => {
    expect(defaultCropFor({ width: 300, height: 300 }, 1)).toEqual({
      x: 0,
      y: 0,
      w: 1,
      h: 1,
    });
  });

  // tileAspect is height ÷ width, matching ASPECT_RATIO in layout.ts, so a
  // portrait tile is 4/3 and wants a taller-than-wide slice of the source.
  it("matches a portrait tile against a square source", () => {
    const crop = defaultCropFor({ width: 100, height: 100 }, 4 / 3);
    expect(crop.h).toBe(1);
    expect(crop.w).toBeCloseTo(0.75, 10);
    expect(crop.x).toBeCloseTo(0.125, 10);
    expect(crop.y).toBe(0);
  });

  it("returns a crop whose own aspect equals the tile's", () => {
    for (const source of [
      { width: 1920, height: 1080 },
      { width: 640, height: 480 },
      { width: 33, height: 977 },
    ]) {
      for (const aspect of [1, 4 / 3, 3 / 4]) {
        const crop = defaultCropFor(source, aspect);
        const cropped = { w: crop.w * source.width, h: crop.h * source.height };
        expect(cropped.h / cropped.w).toBeCloseTo(aspect, 6);
      }
    }
  });

  // migrate() performs no structural validation, so a document can carry an
  // item whose source metadata is empty, missing, or corrupted. Without a
  // guard, `sourceAspect` becomes NaN or Infinity/Infinity (also NaN), and
  // every `>` comparison against NaN is false, so the function falls through
  // to the `else` branch and returns a crop with NaN fields — a bad value
  // that would otherwise sit silently in the document until something tried
  // to render it.
  describe("degenerate input", () => {
    it("refuses a zero-width source", () => {
      expect(() => defaultCropFor({ width: 0, height: 100 }, 1)).toThrow();
    });

    it("refuses a zero-height source", () => {
      expect(() => defaultCropFor({ width: 100, height: 0 }, 1)).toThrow();
    });

    it("refuses a zero-width and zero-height source", () => {
      expect(() => defaultCropFor({ width: 0, height: 0 }, 1)).toThrow();
    });

    it("refuses a NaN source dimension", () => {
      expect(() => defaultCropFor({ width: NaN, height: 100 }, 1)).toThrow();
      expect(() => defaultCropFor({ width: 100, height: NaN }, 1)).toThrow();
    });

    it("refuses a tileAspect of 0", () => {
      expect(() => defaultCropFor({ width: 100, height: 100 }, 0)).toThrow();
    });

    it("refuses a non-finite tileAspect", () => {
      expect(() => defaultCropFor({ width: 100, height: 100 }, Infinity)).toThrow();
      expect(() => defaultCropFor({ width: 100, height: 100 }, NaN)).toThrow();
    });
  });
});

describe("imagePlacement", () => {
  it("maps a full crop onto the whole tile", () => {
    const source: SourceSize = { width: 400, height: 400 };
    const placement = imagePlacement(source, editWith({ x: 0, y: 0, w: 1, h: 1 }), TILE);
    expect(placement.source).toEqual({ x: 0, y: 0, width: 400, height: 400 });
    expect(placement.dest).toEqual(TILE);
  });

  // The crop is in normalized source units, so this is the sampling rectangle
  // in source *pixels* — which is what a renderer needs to hand Skia.
  it("converts a normalized crop into source pixels", () => {
    const source: SourceSize = { width: 400, height: 200 };
    const placement = imagePlacement(
      source,
      editWith({ x: 0.25, y: 0.5, w: 0.5, h: 0.5 }),
      TILE,
    );
    expect(placement.source).toEqual({ x: 100, y: 100, width: 200, height: 100 });
  });

  it("always paints the whole tile, whatever the crop", () => {
    const source: SourceSize = { width: 999, height: 37 };
    for (const crop of [
      { x: 0, y: 0, w: 1, h: 1 },
      { x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
      { x: 0.1, y: 0.9, w: 0.2, h: 0.05 },
    ]) {
      expect(imagePlacement(source, editWith(crop), TILE).dest).toEqual(TILE);
    }
  });

  it("clamps a crop that runs past the source rather than sampling outside it", () => {
    const source: SourceSize = { width: 100, height: 100 };
    const placement = imagePlacement(
      source,
      editWith({ x: 0.8, y: 0.8, w: 0.5, h: 0.5 }),
      TILE,
    );
    expect(placement.source.x + placement.source.width).toBeLessThanOrEqual(100);
    expect(placement.source.y + placement.source.height).toBeLessThanOrEqual(100);
  });

  it("never returns a zero-area source rect", () => {
    const source: SourceSize = { width: 100, height: 100 };
    const placement = imagePlacement(source, editWith({ x: 0, y: 0, w: 0, h: 0 }), TILE);
    expect(placement.source.width).toBeGreaterThan(0);
    expect(placement.source.height).toBeGreaterThan(0);
  });

  // crop.x clamps to exactly 1 (the far edge), leaving zero room before the
  // source's right edge. The MIN_SOURCE_PX floor on width would then have
  // nowhere to fit without x itself giving way — without that, the returned
  // rect samples one pixel past a source that is only 100px wide.
  it("keeps a crop pinned to the far edge entirely inside the source", () => {
    const source: SourceSize = { width: 100, height: 100 };
    const placement = imagePlacement(source, editWith({ x: 1, y: 1, w: 0.5, h: 0.5 }), TILE);
    expect(placement.source.x + placement.source.width).toBeLessThanOrEqual(100);
    expect(placement.source.y + placement.source.height).toBeLessThanOrEqual(100);
  });

  it("keeps a crop.x beyond 1 entirely inside the source", () => {
    const source: SourceSize = { width: 100, height: 100 };
    const placement = imagePlacement(source, editWith({ x: 1.5, y: 1.5, w: 0.5, h: 0.5 }), TILE);
    expect(placement.source.x + placement.source.width).toBeLessThanOrEqual(100);
    expect(placement.source.y + placement.source.height).toBeLessThanOrEqual(100);
  });

  // rotation is deliberately unimplemented in Milestone 3A. It must fail
  // loudly rather than draw the wrong thing.
  it("refuses a rotation it cannot honour", () => {
    const source: SourceSize = { width: 100, height: 100 };
    const rotated = { ...defaultImageEdit(), rotation: 90 };
    expect(() => imagePlacement(source, rotated, TILE)).toThrow(/rotation/i);
  });

  it("accepts rotation 0", () => {
    const source: SourceSize = { width: 100, height: 100 };
    expect(() => imagePlacement(source, defaultImageEdit(), TILE)).not.toThrow();
  });
});
