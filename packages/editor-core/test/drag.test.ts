import { createTierList, reduce, type TierList } from "@tl/core";
import { describe, expect, it } from "vitest";
import {
  DRAG_HOLD_MS,
  DRAG_SLOP_PX,
  dragReduce,
  idleDrag,
  type DragState,
} from "../src/drag";
import type { Point } from "../src/geometry";
import { layoutBoard, type BoardLayout } from "../src/layout";

const NOW = "2026-08-01T12:00:00.000Z";
const S = "list-1-row-0";
const A = "list-1-row-1";

function populated(): TierList {
  let doc = createTierList({ id: "list-1", now: NOW });
  for (let i = 0; i < 4; i += 1) {
    doc = reduce(doc, { type: "item/addText", id: `i${i}`, label: `i${i}` }, NOW);
  }
  doc = reduce(doc, { type: "placement/place", itemId: "i0", rowId: S, index: 0 }, NOW);
  doc = reduce(doc, { type: "placement/place", itemId: "i1", rowId: S, index: 1 }, NOW);
  doc = reduce(doc, { type: "placement/place", itemId: "i2", rowId: S, index: 2 }, NOW);
  return doc;
}

const LAYOUT: BoardLayout = layoutBoard(populated(), { width: 800 });

function centre(rect: { x: number; y: number; width: number; height: number }) {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

const TILE_1 = centre(LAYOUT.rows[0]!.tiles[1]!.rect);
const ROW_A = centre(LAYOUT.rows[1]!.rect);

const TILE_0 = centre(LAYOUT.rows[0]!.tiles[0]!.rect);

function press(layout: BoardLayout, point: Point) {
  return dragReduce(idleDrag(), {
    type: "down",
    at: { point, time: 0 },
    layout,
  });
}

/**
 * Press and hold until the machine is dragging. `holdLayout` differs from
 * `layout` only in the tests that change the board under the finger.
 */
function pressAndHold(
  layout: BoardLayout,
  point: Point,
  holdLayout: BoardLayout = layout,
) {
  return dragReduce(press(layout, point).state, {
    type: "hold",
    at: { point, time: DRAG_HOLD_MS },
    layout: holdLayout,
  });
}

/** Press and hold on tile i1 until the machine is dragging. */
function dragging(): DragState {
  return pressAndHold(LAYOUT, TILE_1).state;
}

describe("starting a drag", () => {
  it("does nothing when the press misses every tile", () => {
    const result = dragReduce(idleDrag(), {
      type: "down",
      at: { point: { x: 5, y: LAYOUT.contentHeight + 100 }, time: 0 },
      layout: LAYOUT,
    });
    expect(result.state.phase).toBe("idle");
  });

  it("goes pending on a press, without dragging yet", () => {
    const result = dragReduce(idleDrag(), {
      type: "down",
      at: { point: TILE_1, time: 0 },
      layout: LAYOUT,
    });
    expect(result.state.phase).toBe("pending");
    expect(result.action).toBeNull();
  });

  it("promotes a held press to a drag", () => {
    expect(dragging().phase).toBe("dragging");
  });

  it("records where the item came from", () => {
    const state = dragging();
    expect(state).toMatchObject({ itemId: "i1", from: { rowId: S, index: 1 } });
  });

  it("releases to the scroller when the press moves before the hold elapses", () => {
    const down = dragReduce(idleDrag(), {
      type: "down",
      at: { point: TILE_1, time: 0 },
      layout: LAYOUT,
    });
    const moved = dragReduce(down.state, {
      type: "move",
      at: {
        point: { x: TILE_1.x, y: TILE_1.y + DRAG_SLOP_PX + 1 },
        time: DRAG_HOLD_MS - 50,
      },
      layout: LAYOUT,
    });

    expect(moved.state.phase).toBe("idle");
    expect(moved.releaseToScroll).toBe(true);
    expect(moved.action).toBeNull();
  });

  it("tolerates a small wobble during the hold", () => {
    const down = dragReduce(idleDrag(), {
      type: "down",
      at: { point: TILE_1, time: 0 },
      layout: LAYOUT,
    });
    const wobbled = dragReduce(down.state, {
      type: "move",
      at: { point: { x: TILE_1.x + 1, y: TILE_1.y + 1 }, time: 30 },
      layout: LAYOUT,
    });
    expect(wobbled.state.phase).toBe("pending");
    expect(wobbled.releaseToScroll).toBe(false);
  });

  it("promotes on a move that arrives after the hold has elapsed", () => {
    const down = dragReduce(idleDrag(), {
      type: "down",
      at: { point: TILE_1, time: 0 },
      layout: LAYOUT,
    });
    const late = dragReduce(down.state, {
      type: "move",
      at: { point: TILE_1, time: DRAG_HOLD_MS + 1 },
      layout: LAYOUT,
    });
    expect(late.state.phase).toBe("dragging");
  });

  it("treats a press and release as a tap, emitting nothing", () => {
    const down = dragReduce(idleDrag(), {
      type: "down",
      at: { point: TILE_1, time: 0 },
      layout: LAYOUT,
    });
    const up = dragReduce(down.state, {
      type: "up",
      at: { point: TILE_1, time: 100 },
      layout: LAYOUT,
    });
    expect(up.state.phase).toBe("idle");
    expect(up.action).toBeNull();
    expect(up.tapped).toEqual({ itemId: "i1" });
  });
});

describe("during a drag", () => {
  it("tracks the pointer and the target under it", () => {
    const moved = dragReduce(dragging(), {
      type: "move",
      at: { point: ROW_A, time: DRAG_HOLD_MS + 100 },
      layout: LAYOUT,
    });
    expect(moved.state).toMatchObject({
      phase: "dragging",
      pointer: ROW_A,
      target: { rowId: A, index: 0 },
    });
  });

  it("reports a null target when the pointer leaves the board", () => {
    const moved = dragReduce(dragging(), {
      type: "move",
      at: { point: { x: 400, y: LAYOUT.contentHeight + 80 }, time: DRAG_HOLD_MS + 100 },
      layout: LAYOUT,
    });
    expect(moved.state).toMatchObject({ phase: "dragging", target: null });
  });

  it("never emits an action mid-drag", () => {
    const moved = dragReduce(dragging(), {
      type: "move",
      at: { point: ROW_A, time: DRAG_HOLD_MS + 100 },
      layout: LAYOUT,
    });
    expect(moved.action).toBeNull();
  });
});

describe("finishing a drag", () => {
  it("emits a place action for the target under the pointer", () => {
    const moved = dragReduce(dragging(), {
      type: "move",
      at: { point: ROW_A, time: DRAG_HOLD_MS + 100 },
      layout: LAYOUT,
    });
    const dropped = dragReduce(moved.state, {
      type: "up",
      at: { point: ROW_A, time: DRAG_HOLD_MS + 200 },
      layout: LAYOUT,
    });

    expect(dropped.action).toEqual({
      type: "placement/place",
      itemId: "i1",
      rowId: A,
      index: 0,
    });
    expect(dropped.state.phase).toBe("idle");
  });

  it("emits a place action targeting the tray, with a null rowId", () => {
    const moved = dragReduce(dragging(), {
      type: "move",
      at: { point: centre(LAYOUT.tray.rect), time: DRAG_HOLD_MS + 100 },
      layout: LAYOUT,
    });
    const dropped = dragReduce(moved.state, {
      type: "up",
      at: { point: centre(LAYOUT.tray.rect), time: DRAG_HOLD_MS + 200 },
      layout: LAYOUT,
    });
    expect(dropped.action).toMatchObject({ type: "placement/place", rowId: null });
  });

  it("emits nothing when the item is dropped exactly where it started", () => {
    const dropped = dragReduce(dragging(), {
      type: "up",
      at: { point: TILE_1, time: DRAG_HOLD_MS + 200 },
      layout: LAYOUT,
    });
    expect(dropped.action).toBeNull();
    expect(dropped.state.phase).toBe("idle");
  });

  it("emits nothing when the item is dropped off the board", () => {
    const moved = dragReduce(dragging(), {
      type: "move",
      at: { point: { x: 400, y: LAYOUT.contentHeight + 80 }, time: DRAG_HOLD_MS + 100 },
      layout: LAYOUT,
    });
    const dropped = dragReduce(moved.state, {
      type: "up",
      at: { point: { x: 400, y: LAYOUT.contentHeight + 80 }, time: DRAG_HOLD_MS + 200 },
      layout: LAYOUT,
    });
    expect(dropped.action).toBeNull();
  });

  it("abandons the drag on cancel without emitting anything", () => {
    const cancelled = dragReduce(dragging(), { type: "cancel" });
    expect(cancelled.state.phase).toBe("idle");
    expect(cancelled.action).toBeNull();
  });

  // The row cases above both land in a *different* row. Reordering within one
  // row is the commonest gesture there is, and it is the only one where the
  // no-op check has to separate on index alone.
  it("emits a reorder when the item moves within its own row", () => {
    const dropped = dragReduce(dragging(), {
      type: "up",
      // Left of i0's centre, so nothing in the row counts as before the point.
      at: { point: { x: TILE_0.x - 40, y: TILE_0.y }, time: DRAG_HOLD_MS + 200 },
      layout: LAYOUT,
    });
    expect(dropped.action).toEqual({
      type: "placement/place",
      itemId: "i1",
      rowId: S,
      index: 0,
    });
  });

  // ...and the mirror image: the index is unchanged but the row is not. A
  // no-op check that compared only the index would swallow this drop.
  it("emits when the index matches its old one but the row differs", () => {
    const layout = layoutBoard(
      reduce(populated(), { type: "placement/place", itemId: "i3", rowId: A, index: 0 }, NOW),
      { width: 800 },
    );
    const occupied = layout.rows[1]!.tiles[0]!.rect;
    // Right of i3's centre, so the drop lands after it: row A, index 1.
    const after = { x: occupied.x + occupied.width - 1, y: centre(occupied).y };

    const dropped = dragReduce(pressAndHold(layout, TILE_1).state, {
      type: "up",
      at: { point: after, time: DRAG_HOLD_MS + 200 },
      layout,
    });

    expect(dropped.action).toEqual({
      type: "placement/place",
      itemId: "i1",
      rowId: A,
      index: 1,
    });
  });

  // The no-op check has to recognise the tray as a location like any other.
  // The tray is the one branch of the lookup a row-only test never reaches.
  it("emits nothing when a tray item is dropped back on itself", () => {
    let doc = createTierList({ id: "list-1", now: NOW });
    for (let i = 0; i < 4; i += 1) {
      doc = reduce(doc, { type: "item/addText", id: `i${i}`, label: `i${i}` }, NOW);
    }
    const layout = layoutBoard(doc, { width: 800 });
    const trayTile = layout.tray.tiles[2]!;
    expect(trayTile.itemId).toBe("i2");

    const dropped = dragReduce(pressAndHold(layout, centre(trayTile.rect)).state, {
      type: "up",
      at: { point: centre(trayTile.rect), time: DRAG_HOLD_MS + 200 },
      layout,
    });

    expect(dropped.action).toBeNull();
  });

  // A finger can lift somewhere the last move never reported — the platform
  // coalesces moves, and the up carries its own position. The drop has to be
  // decided by where the finger left the glass, not by the last tracked target.
  it("decides the drop from the release point, not the last move", () => {
    const off = { x: 400, y: LAYOUT.contentHeight + 80 };
    const moved = dragReduce(dragging(), {
      type: "move",
      at: { point: off, time: DRAG_HOLD_MS + 100 },
      layout: LAYOUT,
    });
    expect(moved.state).toMatchObject({ target: null });

    const dropped = dragReduce(moved.state, {
      type: "up",
      at: { point: ROW_A, time: DRAG_HOLD_MS + 200 },
      layout: LAYOUT,
    });
    expect(dropped.action).toMatchObject({ rowId: A, index: 0 });
  });

  // No-op detection rests on two numbers computed by different code paths
  // agreeing: where the machine says the item came from, and where
  // `insertionIndex` puts a point over that same tile. One sampled slot is not
  // enough to trust that — a wrapped row and the tray both have to hold, or
  // some slots would silently commit a place that changes nothing.
  it("recognises a no-op drop at every slot, wrapped row and tray alike", () => {
    let doc = createTierList({ id: "list-1", now: NOW });
    for (let i = 0; i < 10; i += 1) {
      doc = reduce(doc, { type: "item/addText", id: `i${i}`, label: `i${i}` }, NOW);
    }
    for (let i = 0; i < 8; i += 1) {
      doc = reduce(doc, { type: "placement/place", itemId: `i${i}`, rowId: S, index: i }, NOW);
    }
    const layout = layoutBoard(doc, { width: 800 });
    const row = layout.rows[0]!;

    // 8 tiles at 6 columns: a full first line and a partial second one.
    expect(row.tiles).toHaveLength(8);
    expect(row.tiles[6]!.rect.y).toBeGreaterThan(row.tiles[5]!.rect.y);
    expect(layout.tray.tiles).toHaveLength(2);

    for (const tile of [...row.tiles, ...layout.tray.tiles]) {
      const point = centre(tile.rect);
      const held = pressAndHold(layout, point);
      expect(held.state).toMatchObject({ phase: "dragging", itemId: tile.itemId });

      const dropped = dragReduce(held.state, {
        type: "up",
        at: { point, time: DRAG_HOLD_MS + 200 },
        layout,
      });
      expect(dropped.action).toBeNull();
    }
  });

  it("leaves no residue behind once the gesture is over", () => {
    const dropped = dragReduce(dragging(), {
      type: "up",
      at: { point: ROW_A, time: DRAG_HOLD_MS + 200 },
      layout: LAYOUT,
    });
    expect(dropped.state).toEqual(idleDrag());
  });
});

describe("events the machine must ignore", () => {
  it("ignores a move, a hold or an up while idle", () => {
    for (const type of ["move", "hold", "up"] as const) {
      const result = dragReduce(idleDrag(), {
        type,
        at: { point: TILE_1, time: 10 },
        layout: LAYOUT,
      });
      expect(result.state.phase).toBe("idle");
      expect(result.action).toBeNull();
      expect(result.tapped).toBeNull();
      expect(result.releaseToScroll).toBe(false);
    }
  });

  // A caller that arms a hold timer on every press cannot un-arm it in time
  // for a fast scroll. The stale timer must not resurrect a gesture the
  // machine has already handed to the scroller.
  it("does not start a drag when a hold fires after the press was released", () => {
    const away = { x: TILE_1.x, y: TILE_1.y + 40 };
    const released = dragReduce(press(LAYOUT, TILE_1).state, {
      type: "move",
      at: { point: away, time: 100 },
      layout: LAYOUT,
    });
    expect(released.releaseToScroll).toBe(true);

    const late = dragReduce(released.state, {
      type: "hold",
      at: { point: away, time: DRAG_HOLD_MS },
      layout: LAYOUT,
    });
    expect(late.state.phase).toBe("idle");
  });

  it("ignores a second finger going down while a press is pending", () => {
    const down = press(LAYOUT, TILE_1);
    const second = dragReduce(down.state, {
      type: "down",
      at: { point: TILE_0, time: 20 },
      layout: LAYOUT,
    });
    expect(second.state).toEqual(down.state);
  });

  it("ignores a second finger going down mid-drag", () => {
    const state = dragging();
    const second = dragReduce(state, {
      type: "down",
      at: { point: TILE_0, time: DRAG_HOLD_MS + 10 },
      layout: LAYOUT,
    });
    expect(second.state).toEqual(state);
  });

  it("cancels a pending press without reporting a tap", () => {
    const cancelled = dragReduce(press(LAYOUT, TILE_1).state, { type: "cancel" });
    expect(cancelled.state.phase).toBe("idle");
    expect(cancelled.tapped).toBeNull();
    expect(cancelled.action).toBeNull();
  });
});

describe("the hold and slop boundaries", () => {
  it("is still holding at exactly the slop distance, and tracks the pointer", () => {
    const point = { x: TILE_1.x, y: TILE_1.y + DRAG_SLOP_PX };
    const moved = dragReduce(press(LAYOUT, TILE_1).state, {
      type: "move",
      at: { point, time: 50 },
      layout: LAYOUT,
    });
    expect(moved.state).toMatchObject({ phase: "pending", pointer: point });
  });

  // The release test in the plan only ever moves down the screen. A slop test
  // that measured one axis would pass it and still steal a horizontal swipe.
  it("releases a sideways press to the scroller too", () => {
    const moved = dragReduce(press(LAYOUT, TILE_1).state, {
      type: "move",
      at: { point: { x: TILE_1.x + DRAG_SLOP_PX + 1, y: TILE_1.y }, time: 50 },
      layout: LAYOUT,
    });
    expect(moved.state.phase).toBe("idle");
    expect(moved.releaseToScroll).toBe(true);
  });

  // Slop is distance from the press, not from the previous sample. Measured
  // sample to sample, a finger could creep any distance at all in small steps
  // and still count as holding still.
  it("measures slop from the press, not from the previous sample", () => {
    const first = dragReduce(press(LAYOUT, TILE_1).state, {
      type: "move",
      at: { point: { x: TILE_1.x, y: TILE_1.y + 6 }, time: 40 },
      layout: LAYOUT,
    });
    expect(first.state.phase).toBe("pending");

    const second = dragReduce(first.state, {
      type: "move",
      at: { point: { x: TILE_1.x, y: TILE_1.y + 12 }, time: 80 },
      layout: LAYOUT,
    });
    expect(second.state.phase).toBe("idle");
    expect(second.releaseToScroll).toBe(true);
  });

  it("has not promoted one millisecond before the hold elapses", () => {
    const early = dragReduce(press(LAYOUT, TILE_1).state, {
      type: "move",
      at: { point: TILE_1, time: DRAG_HOLD_MS - 1 },
      layout: LAYOUT,
    });
    expect(early.state.phase).toBe("pending");
  });

  // The elapsed time alone is not evidence the finger was still: a janky
  // frame on a mid-range Android can swallow every move of a fast flick and
  // deliver the first one late. Promoting on it would turn that flick into a
  // drag and leave the board unscrollable exactly when it is struggling most.
  it("releases a first move that arrives late having already travelled", () => {
    const late = dragReduce(press(LAYOUT, TILE_1).state, {
      type: "move",
      at: { point: { x: TILE_1.x, y: TILE_1.y + 150 }, time: DRAG_HOLD_MS + 50 },
      layout: LAYOUT,
    });
    expect(late.state.phase).toBe("idle");
    expect(late.releaseToScroll).toBe(true);
  });

  it("grabs the tile where the finger is, so it does not jump on pickup", () => {
    const point = { x: TILE_1.x + 3, y: TILE_1.y + 3 };
    const promoted = dragReduce(press(LAYOUT, TILE_1).state, {
      type: "move",
      at: { point, time: DRAG_HOLD_MS + 1 },
      layout: LAYOUT,
    });

    // Drawing the preview at `pointer - grab` must reproduce the tile exactly
    // where it already is, or the tile jumps the moment the drag begins.
    const tile = LAYOUT.rows[0]!.tiles[1]!.rect;
    expect(promoted.state).toMatchObject({
      phase: "dragging",
      grab: { x: point.x - tile.x, y: point.y - tile.y },
    });
  });
});

describe("immediate drags (mouse)", () => {
  function pressImmediate(layout: BoardLayout, point: Point) {
    return dragReduce(idleDrag(), {
      type: "down",
      at: { point, time: 0 },
      layout,
      immediate: true,
    });
  }

  it("promotes on a move past slop when immediate is set, without waiting for the hold", () => {
    const down = pressImmediate(LAYOUT, TILE_1);
    const moved = dragReduce(down.state, {
      type: "move",
      at: { point: { x: TILE_1.x, y: TILE_1.y + DRAG_SLOP_PX + 1 }, time: 1 },
      layout: LAYOUT,
    });
    expect(moved.state.phase).toBe("dragging");
    expect(moved.releaseToScroll).toBe(false);
  });

  it("still releases to the scroller on the same move when immediate is not set", () => {
    const down = press(LAYOUT, TILE_1);
    const moved = dragReduce(down.state, {
      type: "move",
      at: { point: { x: TILE_1.x, y: TILE_1.y + DRAG_SLOP_PX + 1 }, time: 1 },
      layout: LAYOUT,
    });
    expect(moved.state.phase).toBe("idle");
    expect(moved.releaseToScroll).toBe(true);
  });

  // Mirrors "grabs the tile where the finger is, so it does not jump on
  // pickup" in the slop-boundary suite below: the immediate path promotes
  // through the very same `promote` the hold path uses, so it must compute
  // `grab` the identical way — from the sample that triggers the promotion
  // and the tile's rect, not from the original press.
  it("grabs the tile the same way the hold path would, for the same press and point", () => {
    const point = { x: TILE_1.x, y: TILE_1.y + DRAG_SLOP_PX + 1 };
    const promoted = dragReduce(pressImmediate(LAYOUT, TILE_1).state, {
      type: "move",
      at: { point, time: 1 },
      layout: LAYOUT,
    });

    const tile = LAYOUT.rows[0]!.tiles[1]!.rect;
    expect(promoted.state).toMatchObject({
      phase: "dragging",
      grab: { x: point.x - tile.x, y: point.y - tile.y },
    });
  });

  it("still treats a press and release with no movement as a tap when immediate is set", () => {
    const down = pressImmediate(LAYOUT, TILE_1);
    const up = dragReduce(down.state, {
      type: "up",
      at: { point: TILE_1, time: 10 },
      layout: LAYOUT,
    });
    expect(up.state.phase).toBe("idle");
    expect(up.action).toBeNull();
    expect(up.tapped).toEqual({ itemId: "i1" });
  });

  it("still promotes on a genuine hold when immediate is set and the user holds before moving", () => {
    const down = pressImmediate(LAYOUT, TILE_1);
    const held = dragReduce(down.state, {
      type: "hold",
      at: { point: TILE_1, time: DRAG_HOLD_MS },
      layout: LAYOUT,
    });
    expect(held.state.phase).toBe("dragging");

    // ...and behaves exactly like an ordinary hold-promoted drag from there.
    const dropped = dragReduce(held.state, {
      type: "up",
      at: { point: ROW_A, time: DRAG_HOLD_MS + 100 },
      layout: LAYOUT,
    });
    expect(dropped.action).toMatchObject({ rowId: A, index: 0 });
  });
});

describe("when the layout changes under the finger", () => {
  // A sync from another device can delete the item between the press and the
  // hold. Dragging on would emit a place for an item the document no longer
  // has, and `placement/place` does not check that the item exists.
  it("abandons the press when the item is gone by the time the hold elapses", () => {
    const without = layoutBoard(
      reduce(populated(), { type: "item/remove", itemId: "i1" }, NOW),
      { width: 800 },
    );
    const held = pressAndHold(LAYOUT, TILE_1, without);

    expect(held.state.phase).toBe("idle");
    expect(held.action).toBeNull();
    // The finger is still down and this machine is not taking the gesture,
    // so the scroller should have it.
    expect(held.releaseToScroll).toBe(true);
  });

  // "Where it came from" has to mean where it was when the drag began, not
  // where it was when the finger landed. Otherwise the no-op check compares
  // against a home the item has already left.
  it("takes the item's home from the layout the drag actually starts in", () => {
    const moved = layoutBoard(
      reduce(populated(), { type: "placement/place", itemId: "i1", rowId: A, index: 0 }, NOW),
      { width: 800 },
    );
    const held = pressAndHold(LAYOUT, TILE_1, moved);
    expect(held.state).toMatchObject({ from: { rowId: A, index: 0 } });

    // ...so a drop onto its new home is still recognised as changing nothing.
    const home = centre(moved.rows[1]!.tiles[0]!.rect);
    const dropped = dragReduce(held.state, {
      type: "up",
      at: { point: home, time: DRAG_HOLD_MS + 200 },
      layout: moved,
    });
    expect(dropped.action).toBeNull();
  });
});
