import { describe, expect, it } from "vitest";
import { contains } from "../src/geometry";

const RECT = { x: 10, y: 20, width: 100, height: 50 };

describe("contains", () => {
  it("accepts a point inside", () => {
    expect(contains(RECT, { x: 60, y: 45 })).toBe(true);
  });

  it("accepts the top-left corner", () => {
    expect(contains(RECT, { x: 10, y: 20 })).toBe(true);
  });

  it("rejects the right and bottom edges, so stacked rects cannot both claim a point", () => {
    expect(contains(RECT, { x: 110, y: 45 })).toBe(false);
    expect(contains(RECT, { x: 60, y: 70 })).toBe(false);
  });

  it("rejects a point outside on any side", () => {
    expect(contains(RECT, { x: 9, y: 45 })).toBe(false);
    expect(contains(RECT, { x: 60, y: 19 })).toBe(false);
    expect(contains(RECT, { x: 200, y: 200 })).toBe(false);
  });
});
