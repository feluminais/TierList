import { describe, expect, it } from "vitest";
import { simplifyPoints, strokeFromPoints, toSourcePoint, toTilePoint } from "../src/strokes";

const TILE = { x: 100, y: 50, width: 200, height: 200 };
const CROP = { x: 0.25, y: 0.25, w: 0.5, h: 0.5 };

describe("toSourcePoint", () => {
  // Strokes are stored against the *source image*, not the tile and not the
  // crop, so that re-cropping moves the picture and the drawing together.
  it("maps the tile's top-left corner to the crop's top-left in source space", () => {
    expect(toSourcePoint({ x: 100, y: 50 }, TILE, CROP)).toEqual({ x: 0.25, y: 0.25 });
  });

  it("maps the tile's centre to the crop's centre", () => {
    expect(toSourcePoint({ x: 200, y: 150 }, TILE, CROP)).toEqual({ x: 0.5, y: 0.5 });
  });

  it("maps the tile's bottom-right to the crop's bottom-right", () => {
    expect(toSourcePoint({ x: 300, y: 250 }, TILE, CROP)).toEqual({ x: 0.75, y: 0.75 });
  });

  it("uses the whole source when the crop is full", () => {
    const full = { x: 0, y: 0, w: 1, h: 1 };
    expect(toSourcePoint({ x: 200, y: 150 }, TILE, full)).toEqual({ x: 0.5, y: 0.5 });
  });

  // A finger can leave the tile mid-stroke. That is not an error, and clamping
  // would bunch points up against the edge rather than letting the stroke run
  // off it, so coordinates outside 0..1 are allowed through.
  it("allows a point outside the tile to land outside the crop", () => {
    const outside = toSourcePoint({ x: 0, y: 0 }, TILE, CROP);
    expect(outside.x).toBeLessThan(0.25);
    expect(outside.y).toBeLessThan(0.25);
  });

  // A non-square tile and an asymmetric crop: if x and y were transposed
  // anywhere in the implementation, this would catch it because the tile's
  // width/height and the crop's w/h differ in these cases.
  it("does not transpose x and y for a non-square tile with an asymmetric crop", () => {
    const wideTile = { x: 0, y: 0, width: 400, height: 100 };
    const asymCrop = { x: 0.1, y: 0.6, w: 0.2, h: 0.3 };
    // Point 1/4 of the way across (x), 1/2 down (y).
    const p = toSourcePoint({ x: 100, y: 50 }, wideTile, asymCrop);
    expect(p.x).toBeCloseTo(0.1 + 0.25 * 0.2, 10);
    expect(p.y).toBeCloseTo(0.6 + 0.5 * 0.3, 10);
  });

  // A zero-width or zero-height tile is a division by zero: NaN or Infinity
  // silently written into a stroke's points. `layoutBoard` cannot produce one,
  // but nothing stops a caller from passing one, so this must fail loudly —
  // consistent with `defaultCropFor` and `imagePlacement`'s guards.
  it("refuses a zero-width tile", () => {
    const degenerate = { x: 10, y: 10, width: 0, height: 50 };
    expect(() => toSourcePoint({ x: 10, y: 20 }, degenerate, CROP)).toThrow();
  });

  it("refuses a zero-height tile", () => {
    const degenerate = { x: 10, y: 10, width: 50, height: 0 };
    expect(() => toSourcePoint({ x: 20, y: 10 }, degenerate, CROP)).toThrow();
  });
});

describe("simplifyPoints", () => {
  it("leaves a two-point line alone", () => {
    expect(simplifyPoints([0, 0, 1, 1], 0.01)).toEqual([0, 0, 1, 1]);
  });

  it("drops points that sit on the line between their neighbours", () => {
    // A straight run of five collinear points is fully described by its ends.
    expect(simplifyPoints([0, 0, 0.25, 0.25, 0.5, 0.5, 0.75, 0.75, 1, 1], 0.01))
      .toEqual([0, 0, 1, 1]);
  });

  it("keeps a point that genuinely departs from the line", () => {
    const simplified = simplifyPoints([0, 0, 0.5, 0.5, 1, 0], 0.01);
    expect(simplified).toEqual([0, 0, 0.5, 0.5, 1, 0]);
  });

  it("keeps corners of a zigzag", () => {
    const zigzag = [0, 0, 0.25, 0.5, 0.5, 0, 0.75, 0.5, 1, 0];
    expect(simplifyPoints(zigzag, 0.01)).toEqual(zigzag);
  });

  it("removes more points as tolerance rises", () => {
    const wobbly = [0, 0, 0.25, 0.02, 0.5, 0, 0.75, 0.02, 1, 0];
    const tight = simplifyPoints(wobbly, 0.001);
    const loose = simplifyPoints(wobbly, 0.1);
    expect(loose.length).toBeLessThan(tight.length);
    expect(loose).toEqual([0, 0, 1, 0]);
  });

  it("always keeps the first and last point", () => {
    const points = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8];
    const simplified = simplifyPoints(points, 10);
    expect(simplified.slice(0, 2)).toEqual([0.1, 0.2]);
    expect(simplified.slice(-2)).toEqual([0.7, 0.8]);
  });

  it("handles a single point", () => {
    expect(simplifyPoints([0.5, 0.5], 0.01)).toEqual([0.5, 0.5]);
  });

  it("handles an empty stroke", () => {
    expect(simplifyPoints([], 0.01)).toEqual([]);
  });

  // Every point identical is a tap, not a line, and the perpendicular-distance
  // formula divides by the segment length — which is zero here.
  it("survives a run of identical points", () => {
    expect(() => simplifyPoints([0.5, 0.5, 0.5, 0.5, 0.5, 0.5], 0.01)).not.toThrow();
    expect(simplifyPoints([0.5, 0.5, 0.5, 0.5, 0.5, 0.5], 0.01)).toEqual([0.5, 0.5, 0.5, 0.5]);
  });

  // A point sitting exactly `tolerance` away from the line is not a genuine
  // departure — it is indistinguishable from noise at the chosen tolerance —
  // so it must be dropped. Using `>=` here instead of `>` would keep it,
  // which is not directly visible from the plan's other tests because none of
  // them construct an exact-equality boundary.
  it("drops a point sitting exactly at the tolerance distance from the line", () => {
    // (0.5, 0.05) is exactly 0.05 away from the line y=0 between (0,0) and (1,0).
    expect(simplifyPoints([0, 0, 0.5, 0.05, 1, 0], 0.05)).toEqual([0, 0, 1, 0]);
  });
});

describe("strokeFromPoints", () => {
  it("builds a stroke carrying the id, colour and width it was given", () => {
    const stroke = strokeFromPoints("s1", [0, 0, 1, 1], "#4ade80", 3, 0.01);
    expect(stroke).toEqual({
      id: "s1",
      points: [0, 0, 1, 1],
      color: "#4ade80",
      width: 3,
    });
  });

  it("simplifies the points it stores", () => {
    const stroke = strokeFromPoints(
      "s1",
      [0, 0, 0.5, 0.5, 1, 1],
      "#fff",
      2,
      0.01,
    );
    expect(stroke.points).toEqual([0, 0, 1, 1]);
  });
});

describe("toTilePoint", () => {
  const TILE = { x: 100, y: 50, width: 200, height: 200 };
  const CROP = { x: 0.25, y: 0.25, w: 0.5, h: 0.5 };

  it("is the inverse of toSourcePoint", () => {
    for (const point of [
      { x: 100, y: 50 },
      { x: 200, y: 150 },
      { x: 300, y: 250 },
      { x: 137, y: 201 },
    ]) {
      const round = toTilePoint(toSourcePoint(point, TILE, CROP), TILE, CROP);
      expect(round.x).toBeCloseTo(point.x, 9);
      expect(round.y).toBeCloseTo(point.y, 9);
    }
  });

  it("maps the crop's top-left to the tile's top-left", () => {
    expect(toTilePoint({ x: 0.25, y: 0.25 }, TILE, CROP)).toEqual({ x: 100, y: 50 });
  });

  // A stroke drawn before a tighter crop can legitimately fall outside it. The
  // renderer clips; this must not clamp, or the stroke would smear along the edge.
  it("allows a point outside the crop to land outside the tile", () => {
    const out = toTilePoint({ x: 0, y: 0 }, TILE, CROP);
    expect(out.x).toBeLessThan(100);
    expect(out.y).toBeLessThan(50);
  });

  it("refuses a zero-sized crop rather than dividing by it", () => {
    expect(() => toTilePoint({ x: 0.5, y: 0.5 }, TILE, { x: 0, y: 0, w: 0, h: 1 })).toThrow(/zero/i);
  });

  // TILE and CROP above are both square (200x200, 0.5x0.5), so a mutant that
  // swaps tile.width for tile.height inside the y calculation is invisible to
  // every test above — both are 200. A non-square tile with a non-square crop
  // is what actually distinguishes the two axes; this is the same trap the
  // toSourcePoint tests above call out by name, now caught here too.
  it("does not transpose tile.width and tile.height for a non-square tile with an asymmetric crop", () => {
    const wideTile = { x: 0, y: 0, width: 400, height: 100 };
    const asymCrop = { x: 0.1, y: 0.6, w: 0.2, h: 0.3 };
    // Source point 1/4 of the way across the crop's width, 1/2 down its height.
    const p = toTilePoint({ x: 0.1 + 0.25 * 0.2, y: 0.6 + 0.5 * 0.3 }, wideTile, asymCrop);
    expect(p.x).toBeCloseTo(100, 10);
    expect(p.y).toBeCloseTo(50, 10);
  });
});
