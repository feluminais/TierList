import { defaultImageEdit } from "@tl/core";
import type { ImageEdit } from "@tl/core";
import { describe, expect, it } from "vitest";
import { defaultCropFor, imageDrawRect, imagePlacement, type SourceSize } from "../src/imagefit";

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

describe("imageDrawRect", () => {
  const TILE_100 = { x: 0, y: 0, width: 100, height: 100 };

  it("draws the whole image at tile size when the crop is the whole source", () => {
    const rect = imageDrawRect(
      { source: { x: 0, y: 0, width: 200, height: 200 }, dest: TILE_100 },
      { width: 200, height: 200 },
    );
    expect(rect).toEqual({ x: 0, y: 0, width: 100, height: 100 });
  });

  // The crop is a 100x200 (portrait) slice of a 200x200 image against a
  // square 100x100 tile — the crop's aspect (2) does not match the tile's (1).
  // A single scale is chosen to *cover* the tile: the width axis needs ×1
  // (source is already 100px wide) and the height axis needs ×0.5 (200 source
  // px into a 100px tile); the larger, ×1, wins, so the width axis lands
  // exactly on the tile and the height axis overflows it symmetrically
  // (centred), to be discarded by the tile's clip. Distorting the image to
  // make both axes land exactly — the pre-fix behaviour — is exactly the bug
  // this invariant rules out.
  it("covers the tile without distortion when the crop's aspect does not match", () => {
    const rect = imageDrawRect(
      { source: { x: 100, y: 0, width: 100, height: 200 }, dest: TILE_100 },
      { width: 200, height: 200 },
    );
    // scale = max(100/100, 100/200) = 1. The whole 200x200 image is drawn at
    // 200x200 (uniformly, not stretched), shifted so the crop (the right
    // 100x200 slice) covers the 100x100 tile, centred vertically: the crop
    // draws at (0, -50, 100, 200), which overflows the tile by 50px on both
    // top and bottom.
    expect(rect).toEqual({ x: -100, y: -50, width: 200, height: 200 });
  });

  it("honours a tile that is not at the origin", () => {
    const rect = imageDrawRect(
      { source: { x: 50, y: 25, width: 50, height: 50 }, dest: { x: 10, y: 20, width: 100, height: 100 } },
      { width: 100, height: 100 },
    );
    // scale is 2 on both axes: the source 50px square becomes the 100px tile.
    expect(rect).toEqual({ x: 10 - 100, y: 20 - 50, width: 200, height: 200 });
  });

  // A landscape crop (200x100) against a square tile: the mirror image of the
  // portrait case above. The larger required scale, ×1 on the height axis,
  // wins; the width axis overflows the tile symmetrically instead.
  it("covers the tile without distortion when the crop is wider than the tile", () => {
    const rect = imageDrawRect(
      { source: { x: 0, y: 0, width: 200, height: 100 }, dest: { x: 0, y: 0, width: 100, height: 100 } },
      { width: 200, height: 100 },
    );
    expect(rect).toEqual({ x: -50, y: 0, width: 200, height: 100 });
  });

  // When the crop's own aspect already equals the tile's, the invariant is the
  // strict one from before this fix: the crop's four corners land exactly on
  // the tile's four corners, with no overflow to clip away.
  describe("when the crop's aspect equals the tile's", () => {
    it("puts the crop's corners exactly on the tile's corners", () => {
      const dest = { x: 7, y: 11, width: 120, height: 45 };
      // Every source rect below shares dest's aspect (120/45 = 8/3).
      const cases = [
        [{ x: 0, y: 0, width: 640, height: 240 }, { width: 640, height: 240 }],
        [{ x: 13, y: 97, width: 320, height: 120 }, { width: 1920, height: 1080 }],
        [{ x: 800, y: 1, width: 80, height: 30 }, { width: 1000, height: 1000 }],
      ] as const;
      for (const [source, size] of cases) {
        const rect = imageDrawRect({ source, dest }, size);
        const scaleX = rect.width / size.width;
        const scaleY = rect.height / size.height;
        expect(scaleX).toBeCloseTo(scaleY, 9);
        expect(rect.x + source.x * scaleX).toBeCloseTo(dest.x, 6);
        expect(rect.y + source.y * scaleY).toBeCloseTo(dest.y, 6);
        expect(rect.x + (source.x + source.width) * scaleX).toBeCloseTo(dest.x + dest.width, 6);
        expect(rect.y + (source.y + source.height) * scaleY).toBeCloseTo(dest.y + dest.height, 6);
      }
    });
  });

  // When the crop's aspect differs from the tile's, corners can no longer be
  // expected to land on the tile's corners — that would require distorting
  // the image. What must still hold: the drawn rect covers the tile entirely,
  // stays centred on it, and never distorts the source (its own aspect ratio
  // survives exactly, because one scale applies to both axes).
  describe("when the crop's aspect differs from the tile's", () => {
    it("covers the tile, stays centred, and preserves the source's aspect ratio", () => {
      const dest = { x: 7, y: 11, width: 120, height: 45 };
      const cases = [
        [{ x: 0, y: 0, width: 640, height: 480 }, { width: 640, height: 480 }],
        [{ x: 13, y: 97, width: 200, height: 150 }, { width: 1920, height: 1080 }],
        [{ x: 999, y: 1, width: 1, height: 1 }, { width: 1000, height: 1000 }],
      ] as const;
      for (const [source, size] of cases) {
        const rect = imageDrawRect({ source, dest }, size);

        // The drawn image's own aspect ratio is untouched — a single scale
        // was applied to both axes of the whole image.
        expect(rect.width / size.width).toBeCloseTo(rect.height / size.height, 9);

        // The crop (the mapped source rect) covers dest entirely...
        const scale = rect.width / size.width;
        const cropLeft = rect.x + source.x * scale;
        const cropTop = rect.y + source.y * scale;
        const cropRight = cropLeft + source.width * scale;
        const cropBottom = cropTop + source.height * scale;
        expect(cropLeft).toBeLessThanOrEqual(dest.x + 1e-6);
        expect(cropTop).toBeLessThanOrEqual(dest.y + 1e-6);
        expect(cropRight).toBeGreaterThanOrEqual(dest.x + dest.width - 1e-6);
        expect(cropBottom).toBeGreaterThanOrEqual(dest.y + dest.height - 1e-6);

        // ...and is centred on it: the overflow on opposite edges matches.
        expect(dest.x - cropLeft).toBeCloseTo(cropRight - (dest.x + dest.width), 6);
        expect(dest.y - cropTop).toBeCloseTo(cropBottom - (dest.y + dest.height), 6);
      }
    });
  });

  it("refuses a zero-sized source rect rather than dividing by it", () => {
    expect(() =>
      imageDrawRect(
        { source: { x: 0, y: 0, width: 0, height: 10 }, dest: TILE_100 },
        { width: 10, height: 10 },
      ),
    ).toThrow(/zero/i);
  });

  // The exact case reported from a real upload: a 2000x1345 WebP into a
  // square 112 tile with a full-frame crop. Before this fix, scaleX
  // (112/2000 = 0.056) and scaleY (112/1345 = 0.0833) were applied
  // independently, stretching the image ~48.7% taller than it should be.
  describe("the reported distortion bug", () => {
    it("does not stretch a 2000x1345 source into a square 112 tile", () => {
      const source: SourceSize = { width: 2000, height: 1345 };
      const tile = { x: 0, y: 0, width: 112, height: 112 };
      const placement = imagePlacement(source, editWith({ x: 0, y: 0, w: 1, h: 1 }), tile);
      const rect = imageDrawRect(placement, source);

      // No distortion: the drawn rect's aspect ratio equals the source's.
      expect(rect.width / source.width).toBeCloseTo(rect.height / source.height, 9);

      // The tile is fully covered.
      expect(rect.x).toBeLessThanOrEqual(tile.x + 1e-6);
      expect(rect.y).toBeLessThanOrEqual(tile.y + 1e-6);
      expect(rect.x + rect.width).toBeGreaterThanOrEqual(tile.x + tile.width - 1e-6);
      expect(rect.y + rect.height).toBeGreaterThanOrEqual(tile.y + tile.height - 1e-6);
    });
  });

  // A deterministic PRNG rather than Math.random(): reproducible on failure,
  // still exercises a wide spread of sources, tiles and crops.
  describe("fuzz", () => {
    function mulberry32(seed: number): () => number {
      let a = seed;
      return () => {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }

    it("always preserves the source's aspect ratio and covers the tile", () => {
      const rand = mulberry32(20260802);
      const between = (min: number, max: number) => min + rand() * (max - min);

      for (let i = 0; i < 500; i++) {
        const source: SourceSize = {
          width: between(1, 4000),
          height: between(1, 4000),
        };
        const tileAspect = [1, 4 / 3, 3 / 4][Math.floor(rand() * 3)]!;
        const tileWidth = between(1, 500);
        const tile = {
          x: between(-100, 100),
          y: between(-100, 100),
          width: tileWidth,
          height: tileWidth * tileAspect,
        };
        // Half the cases use the aspect-locked crop (matches the tile); the
        // other half use a random crop, which usually will not.
        const crop =
          rand() < 0.5
            ? defaultCropFor(source, tileAspect)
            : {
                x: between(0, 0.5),
                y: between(0, 0.5),
                w: between(0.1, 1),
                h: between(0.1, 1),
              };

        const placement = imagePlacement(source, editWith(crop), tile);
        const rect = imageDrawRect(placement, source);

        expect(rect.width / source.width).toBeCloseTo(rect.height / source.height, 6);

        const scale = rect.width / source.width;
        const cropLeft = rect.x + placement.source.x * scale;
        const cropTop = rect.y + placement.source.y * scale;
        const cropRight = cropLeft + placement.source.width * scale;
        const cropBottom = cropTop + placement.source.height * scale;
        const eps = Math.max(1e-6, tile.width * 1e-6);
        expect(cropLeft).toBeLessThanOrEqual(tile.x + eps);
        expect(cropTop).toBeLessThanOrEqual(tile.y + eps);
        expect(cropRight).toBeGreaterThanOrEqual(tile.x + tile.width - eps);
        expect(cropBottom).toBeGreaterThanOrEqual(tile.y + tile.height - eps);
      }
    });
  });
});
