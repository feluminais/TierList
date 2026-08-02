import { describe, expect, it } from "vitest";
import { createTierList } from "../src/factory";
import { reduce } from "../src/reduce";

const NOW = "2026-07-31T12:00:00.000Z";
const LATER = "2026-07-31T13:00:00.000Z";
const ROW = "list-1-row-0";
const OTHER = "list-1-row-1";

function base() {
  return createTierList({ id: "list-1", now: NOW });
}

function withOverride(size: number) {
  return reduce(base(), { type: "row/setTileSize", rowId: ROW, tileSize: size }, LATER);
}

describe("reduce — row/setTileSize", () => {
  it("sets an override on the named row only", () => {
    const next = withOverride(140);
    expect(next.rows.find((r) => r.id === ROW)!.tileSizeOverride).toBe(140);
    expect(next.rows.find((r) => r.id === OTHER)!.tileSizeOverride).toBeUndefined();
  });

  it("leaves display.tileSize alone", () => {
    const doc = base();
    const next = withOverride(140);
    expect(next.display.tileSize).toBe(doc.display.tileSize);
  });

  it("bumps revision and updatedAt", () => {
    const next = withOverride(140);
    expect(next.revision).toBe(1);
    expect(next.updatedAt).toBe(LATER);
  });

  it("replaces an existing override rather than stacking one", () => {
    const once = withOverride(140);
    const twice = reduce(once, { type: "row/setTileSize", rowId: ROW, tileSize: 72 }, LATER);
    expect(twice.rows.find((r) => r.id === ROW)!.tileSizeOverride).toBe(72);
  });

  it("clears the override with null", () => {
    const set = withOverride(140);
    const cleared = reduce(set, { type: "row/setTileSize", rowId: ROW, tileSize: null }, LATER);
    expect(cleared.rows.find((r) => r.id === ROW)!.tileSizeOverride).toBeUndefined();
  });

  /**
   * Not a style point. The document is stored as JSON, and
   * `{tileSizeOverride: undefined}` serialises to `{}` — so a row that kept
   * the key would compare equal to a never-overridden row after a reload and
   * unequal before one, which is exactly the kind of difference that shows up
   * as a phantom autosave rather than as a failure.
   */
  it("removes the key entirely, so a cleared row round-trips through JSON unchanged", () => {
    const cleared = reduce(withOverride(140), {
      type: "row/setTileSize",
      rowId: ROW,
      tileSize: null,
    }, LATER);
    const row = cleared.rows.find((r) => r.id === ROW)!;
    expect(Object.hasOwn(row, "tileSizeOverride")).toBe(false);
    expect(JSON.parse(JSON.stringify(row))).toEqual(row);
  });

  it("does not bump revision for a row that does not exist", () => {
    const doc = base();
    expect(reduce(doc, { type: "row/setTileSize", rowId: "nope", tileSize: 90 }, LATER)).toBe(doc);
  });

  /**
   * A slider fires on every frame it is dragged, and most of those frames land
   * on the value already stored. Returning the same reference is what stops
   * each one becoming a revision, an autosave and an undo step.
   */
  it("does not bump revision when setting the size the row already has", () => {
    const doc = withOverride(140);
    expect(reduce(doc, { type: "row/setTileSize", rowId: ROW, tileSize: 140 }, LATER)).toBe(doc);
  });

  it("does not bump revision when clearing a row that has no override", () => {
    const doc = base();
    expect(reduce(doc, { type: "row/setTileSize", rowId: ROW, tileSize: null }, LATER)).toBe(doc);
  });

  it("does not mutate the input document", () => {
    const doc = base();
    reduce(doc, { type: "row/setTileSize", rowId: ROW, tileSize: 140 }, LATER);
    expect(doc.rows[0]!.tileSizeOverride).toBeUndefined();
  });
});

describe("reduce — display/setUniformTileSize", () => {
  it("sets the list-wide size and drops every override", () => {
    let d = base();
    d = reduce(d, { type: "row/setTileSize", rowId: ROW, tileSize: 200 }, LATER);
    d = reduce(d, { type: "row/setTileSize", rowId: OTHER, tileSize: 60 }, LATER);

    const uniform = reduce(d, { type: "display/setUniformTileSize", tileSize: 120 }, LATER);

    expect(uniform.display.tileSize).toBe(120);
    for (const row of uniform.rows) {
      expect(row.tileSizeOverride).toBeUndefined();
    }
  });

  /**
   * Cleared rather than rewritten to the new value. A row with no override
   * *follows* the list-wide size, so tiers made equal stay equal the next time
   * that size changes; stamping the value onto every row would make them drift
   * apart again on the very next global change.
   */
  it("leaves rows following the list-wide size, not pinned to its current value", () => {
    let d = reduce(base(), { type: "row/setTileSize", rowId: ROW, tileSize: 200 }, LATER);
    d = reduce(d, { type: "display/setUniformTileSize", tileSize: 120 }, LATER);
    d = reduce(d, { type: "display/set", patch: { tileSize: 64 } }, LATER);

    for (const row of d.rows) expect(row.tileSizeOverride).toBeUndefined();
    expect(d.display.tileSize).toBe(64);
  });

  it("removes the key entirely, so a row round-trips through JSON unchanged", () => {
    let d = reduce(base(), { type: "row/setTileSize", rowId: ROW, tileSize: 200 }, LATER);
    d = reduce(d, { type: "display/setUniformTileSize", tileSize: 120 }, LATER);
    const row = d.rows.find((r) => r.id === ROW)!;
    expect(Object.hasOwn(row, "tileSizeOverride")).toBe(false);
    expect(JSON.parse(JSON.stringify(row))).toEqual(row);
  });

  it("bumps the revision once for the whole equalisation", () => {
    let d = reduce(base(), { type: "row/setTileSize", rowId: ROW, tileSize: 200 }, LATER);
    const before = d.revision;
    d = reduce(d, { type: "display/setUniformTileSize", tileSize: 120 }, LATER);
    expect(d.revision).toBe(before + 1);
  });

  it("does not bump the revision when the size already holds everywhere", () => {
    const d = base();
    expect(
      reduce(d, { type: "display/setUniformTileSize", tileSize: d.display.tileSize }, LATER),
    ).toBe(d);
  });

  it("does bump when the size matches but a row still departs from it", () => {
    const d = reduce(base(), { type: "row/setTileSize", rowId: ROW, tileSize: 200 }, LATER);
    const next = reduce(
      d,
      { type: "display/setUniformTileSize", tileSize: d.display.tileSize },
      LATER,
    );
    expect(next).not.toBe(d);
    expect(next.rows.find((r) => r.id === ROW)!.tileSizeOverride).toBeUndefined();
  });

  it("does not mutate the input document", () => {
    const d = reduce(base(), { type: "row/setTileSize", rowId: ROW, tileSize: 200 }, LATER);
    reduce(d, { type: "display/setUniformTileSize", tileSize: 120 }, LATER);
    expect(d.rows.find((r) => r.id === ROW)!.tileSizeOverride).toBe(200);
  });
});
