import { describe, expect, it } from "vitest";
import {
  AUTOSCROLL_EDGE_PX,
  AUTOSCROLL_MAX_PX_PER_FRAME,
  autoScrollDelta,
  pointerAfterScroll,
} from "../src/autoscroll";
import { idleDrag, type DragState } from "../src/drag";

const VIEWPORT = 800;

describe("autoScrollDelta", () => {
  it("does not scroll while the pointer is away from both edges", () => {
    expect(autoScrollDelta(VIEWPORT / 2, VIEWPORT)).toBe(0);
  });

  it("scrolls up near the top edge and down near the bottom", () => {
    expect(autoScrollDelta(4, VIEWPORT)).toBeLessThan(0);
    expect(autoScrollDelta(VIEWPORT - 4, VIEWPORT)).toBeGreaterThan(0);
  });

  it("ramps with depth into the edge rather than switching on", () => {
    const shallow = autoScrollDelta(AUTOSCROLL_EDGE_PX - 4, VIEWPORT);
    const deep = autoScrollDelta(2, VIEWPORT);
    expect(Math.abs(deep)).toBeGreaterThan(Math.abs(shallow));
  });

  it("never exceeds the per-frame cap, however far past the edge", () => {
    expect(Math.abs(autoScrollDelta(-500, VIEWPORT))).toBeLessThanOrEqual(
      AUTOSCROLL_MAX_PX_PER_FRAME,
    );
    expect(Math.abs(autoScrollDelta(VIEWPORT + 500, VIEWPORT))).toBeLessThanOrEqual(
      AUTOSCROLL_MAX_PX_PER_FRAME,
    );
  });

  it("is symmetric about the middle at whole-pixel positions", () => {
    // Stated as cancellation rather than `toBe(-delta)` because in the dead
    // zone both sides are 0 and `Object.is(0, -0)` is false -- exact negation
    // is only writable here for positions that actually scroll.
    //
    // Exact, not approximate, but only where `V - (V - y)` returns `y`
    // unchanged: every whole and half pixel. Not a general property. At a
    // sub-pixel `y` whose mirror lands on a .5 rounding boundary the branches
    // round apart -- y = 64.28571428571429 in an 800px viewport gives -1
    // against +2. One frame, one pixel, at one exact fractional position, so
    // it is recorded here rather than designed out: removing it would mean
    // dropping `Math.round` and returning fractional scroll deltas.
    for (let y = 0; y <= VIEWPORT; y += 1) {
      const up = autoScrollDelta(y, VIEWPORT);
      const down = autoScrollDelta(VIEWPORT - y, VIEWPORT);
      expect(up + down).toBe(0);
      if (up !== 0) expect(up).toBe(-down);
    }
  });

  it("keeps the two edge zones apart on a short viewport", () => {
    // With a viewport smaller than two edge bands, a naive implementation has
    // the top and bottom zones overlap in the middle and fight each other.
    const short = 60;
    expect(autoScrollDelta(short / 2, short)).toBe(0);

    // The midpoint alone is too weak a check: bands capped at half the
    // viewport also leave the exact midpoint neutral while making every other
    // pixel an autoscroll zone. A whole neutral third is the real property --
    // there has to be somewhere on a short board a finger can rest.
    for (let y = short / 3; y <= (short * 2) / 3; y += 1) {
      expect(autoScrollDelta(y, short)).toBe(0);
    }
  });

  it("returns 0 for a degenerate viewport rather than dividing by zero", () => {
    expect(autoScrollDelta(10, 0)).toBe(0);
    expect(Number.isFinite(autoScrollDelta(10, 0))).toBe(true);
  });
});

/** A drag in flight, with the pointer 500px down the *content*. */
function dragging(pointerY = 500): Extract<DragState, { phase: "dragging" }> {
  return {
    phase: "dragging",
    itemId: "i1",
    from: { rowId: "row-0", index: 1 },
    grab: { x: 12, y: 8 },
    pointer: { x: 300, y: pointerY },
    target: { rowId: "row-0", index: 1 },
  };
}

describe("pointerAfterScroll", () => {
  it("has nothing to correct when no drag is in flight", () => {
    expect(pointerAfterScroll(idleDrag(), 0, 40)).toBeNull();
  });

  it("has nothing to correct while a press is only pending", () => {
    const pending: DragState = {
      phase: "pending",
      itemId: "i1",
      origin: { point: { x: 300, y: 500 }, time: 0 },
      pointer: { x: 300, y: 500 },
    };
    expect(pointerAfterScroll(pending, 0, 40)).toBeNull();
  });

  it("has nothing to correct when the board did not move", () => {
    // The end-of-list case: `scrollTo` was asked for 14px and applied zero.
    expect(pointerAfterScroll(dragging(), 120, 120)).toBeNull();
  });

  it("shifts the content pointer by exactly how far the content moved", () => {
    expect(pointerAfterScroll(dragging(500), 100, 114)).toEqual({ x: 300, y: 514 });
  });

  it("shifts back when the board scrolls the other way", () => {
    expect(pointerAfterScroll(dragging(500), 100, 88)).toEqual({ x: 300, y: 488 });
  });

  it("leaves x alone, because only the vertical offset changed", () => {
    expect(pointerAfterScroll(dragging(), 0, 400)!.x).toBe(300);
  });

  it("leaves the pointer's viewport position untouched — the fixed point", () => {
    // This is what stops the loop running away. The frame loop reads
    // `pointer.y - scrollY` to decide the next delta; if a correction changed
    // that, each frame would ask for a larger scroll than the last.
    const state = dragging(500);
    const before = state.pointer.y - 100;
    const after = pointerAfterScroll(state, 100, 114)!.y - 114;
    expect(after).toBe(before);
  });

  it("survives a whole autoscroll run without accumulating error", () => {
    let state = dragging(500);
    let scrollY = 0;
    for (let frame = 0; frame < 60; frame += 1) {
      const next = scrollY + 14;
      const point = pointerAfterScroll(state, scrollY, next)!;
      state = { ...state, pointer: point };
      scrollY = next;
    }
    // 60 frames of scrolling, and the finger is still over the same pixel of
    // the viewport it started on.
    expect(state.pointer.y - scrollY).toBe(500);
  });

  it("refuses a non-finite offset rather than poisoning the pointer", () => {
    expect(pointerAfterScroll(dragging(), Number.NaN, 40)).toBeNull();
    expect(pointerAfterScroll(dragging(), 0, Number.NaN)).toBeNull();
    expect(pointerAfterScroll(dragging(), 0, Number.POSITIVE_INFINITY)).toBeNull();
  });
});
