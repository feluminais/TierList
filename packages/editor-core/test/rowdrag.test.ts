import { createTierList, reduce, type TierList, type TierListAction } from "@tl/core";
import { describe, expect, it } from "vitest";
import { DRAG_HOLD_MS } from "../src/drag";
import { layoutBoard, type BoardLayout } from "../src/layout";
import {
  idleRowDrag,
  rowCaretRect,
  rowDragReduce,
  rowDropIndexAt,
  type RowDragEvent,
  type RowDragState,
} from "../src/rowdrag";

const NOW = "2026-08-01T12:00:00.000Z";
const WIDTH = 800;

/**
 * Tiers of deliberately *unequal* height.
 *
 * A board whose rows are all the same height cannot fail for arithmetic that
 * assumes a fixed step — it would land on the right answer by accident. Giving
 * two tiers size overrides makes every midpoint distinct and unevenly spaced.
 */
function doc(): TierList {
  let d = createTierList({ id: "list-1", now: NOW });
  d = reduce(d, { type: "row/setTileSize", rowId: rowId(d, 1), tileSize: 200 }, NOW);
  d = reduce(d, { type: "row/setTileSize", rowId: rowId(d, 3), tileSize: 140 }, NOW);
  return d;
}

function rowId(d: TierList, index: number): string {
  return [...d.rows].sort((a, b) => a.order - b.order)[index]!.id;
}

function layoutOf(d: TierList): BoardLayout {
  return layoutBoard(d, { width: WIDTH });
}

/** The vertical midpoint of the tier at `index`, in board coordinates. */
function midpointOf(layout: BoardLayout, index: number): number {
  const row = layout.rows[index]!;
  return row.rect.y + row.rect.height / 2;
}

function sample(y: number, time = 0, x = 40) {
  return { point: { x, y }, time };
}

function drive(events: RowDragEvent[]): {
  state: RowDragState;
  actions: TierListAction[];
  taps: string[];
} {
  let state: RowDragState = idleRowDrag();
  const actions: TierListAction[] = [];
  const taps: string[] = [];
  for (const event of events) {
    const out = rowDragReduce(state, event);
    state = out.state;
    if (out.action) actions.push(out.action);
    if (out.tapped) taps.push(out.tapped.rowId);
  }
  return { state, actions, taps };
}

describe("rowDropIndexAt", () => {
  it("counts only the tiers whose midpoint the pointer has passed", () => {
    const d = doc();
    const layout = layoutOf(d);
    const dragged = rowId(d, 0);

    // Above everything.
    expect(rowDropIndexAt(layout, -50, dragged)).toBe(0);
    // Below everything: every other tier passed.
    expect(rowDropIndexAt(layout, 99999, dragged)).toBe(layout.rows.length - 1);
  });

  it("excludes the dragged tier, so a drop in place is the index it started at", () => {
    const d = doc();
    const layout = layoutOf(d);

    for (let index = 0; index < layout.rows.length; index++) {
      const dragged = layout.rows[index]!.rowId;
      // A pointer resting on the tier's own midpoint has passed every tier
      // above it and none below.
      expect(rowDropIndexAt(layout, midpointOf(layout, index), dragged)).toBe(index);
    }
  });

  it("steps at each tier's own midpoint, not at a fixed interval", () => {
    const d = doc();
    const layout = layoutOf(d);
    const dragged = rowId(d, 0);

    const second = layout.rows[1]!;
    const mid = second.rect.y + second.rect.height / 2;
    // The tall tier's midpoint is far from any uniform grid line; one pixel
    // either side of it must give different answers.
    expect(rowDropIndexAt(layout, mid - 1, dragged)).not.toBe(
      rowDropIndexAt(layout, mid + 1, dragged),
    );
  });
});

describe("rowCaretRect", () => {
  it("sits at the top edge of the tier that would be pushed down", () => {
    const d = doc();
    const layout = layoutOf(d);
    const dragged = rowId(d, 0);
    const others = layout.rows.filter((r) => r.rowId !== dragged);

    const caret = rowCaretRect(layout, 1, dragged)!;
    expect(caret.y + caret.height / 2).toBeCloseTo(others[1]!.rect.y, 6);
  });

  it("sits at the bottom of the last tier when the drop is at the end", () => {
    const d = doc();
    const layout = layoutOf(d);
    const dragged = rowId(d, 0);
    const others = layout.rows.filter((r) => r.rowId !== dragged);
    const last = others[others.length - 1]!;

    const caret = rowCaretRect(layout, others.length, dragged)!;
    expect(caret.y + caret.height / 2).toBeCloseTo(last.rect.y + last.rect.height, 6);
  });

  it("clamps an out-of-range index rather than returning nothing", () => {
    const d = doc();
    const layout = layoutOf(d);
    expect(rowCaretRect(layout, -5, rowId(d, 0))).not.toBeNull();
    expect(rowCaretRect(layout, 999, rowId(d, 0))).not.toBeNull();
  });

  it("is null when there is nothing to land between", () => {
    let d = createTierList({ id: "solo", now: NOW });
    for (const row of [...d.rows].slice(1)) {
      d = reduce(d, { type: "row/remove", rowId: row.id }, NOW);
    }
    const layout = layoutOf(d);
    expect(layout.rows).toHaveLength(1);
    expect(rowCaretRect(layout, 0, layout.rows[0]!.rowId)).toBeNull();
  });
});

describe("rowDragReduce", () => {
  it("emits nothing on down, and holds the press pending", () => {
    const d = doc();
    const out = rowDragReduce(idleRowDrag(), {
      type: "down",
      rowId: rowId(d, 0),
      at: sample(10),
      layout: layoutOf(d),
    });
    expect(out.state.phase).toBe("pending");
    expect(out.action).toBeNull();
  });

  it("ignores a press on a tier the layout does not hold", () => {
    const d = doc();
    const out = rowDragReduce(idleRowDrag(), {
      type: "down",
      rowId: "no-such-row",
      at: sample(10),
      layout: layoutOf(d),
    });
    expect(out.state.phase).toBe("idle");
  });

  it("reports a press and release without movement as a tap", () => {
    const d = doc();
    const layout = layoutOf(d);
    const { state, actions, taps } = drive([
      { type: "down", rowId: rowId(d, 0), at: sample(10), layout },
      { type: "up", at: sample(10, 50), layout },
    ]);
    expect(taps).toEqual([rowId(d, 0)]);
    expect(actions).toEqual([]);
    expect(state.phase).toBe("idle");
  });

  /**
   * The touch contract inherited from `dragReduce`: on a touch screen movement
   * already means scroll, so a press that moves before the hold elapses is a
   * scroll and this machine lets it go.
   */
  it("abandons a touch press that moves before the hold elapses", () => {
    const d = doc();
    const layout = layoutOf(d);
    const { state } = drive([
      { type: "down", rowId: rowId(d, 0), at: sample(10), layout },
      { type: "move", at: sample(400, 30), layout },
    ]);
    expect(state.phase).toBe("idle");
  });

  it("promotes a touch press once the hold has elapsed", () => {
    const d = doc();
    const layout = layoutOf(d);
    const { state } = drive([
      { type: "down", rowId: rowId(d, 0), at: sample(10), layout },
      { type: "hold", at: sample(10, DRAG_HOLD_MS), layout },
    ]);
    expect(state.phase).toBe("dragging");
  });

  it("promotes an immediate press on movement alone", () => {
    const d = doc();
    const layout = layoutOf(d);
    const { state } = drive([
      { type: "down", rowId: rowId(d, 0), at: sample(10), layout, immediate: true },
      { type: "move", at: sample(400, 5), layout },
    ]);
    expect(state.phase).toBe("dragging");
  });

  it("emits nothing until the drop, then exactly one row/reorder", () => {
    const d = doc();
    const layout = layoutOf(d);
    const dragged = rowId(d, 0);
    const target = midpointOf(layout, 3) + 1;

    const { actions, state } = drive([
      { type: "down", rowId: dragged, at: sample(midpointOf(layout, 0)), layout, immediate: true },
      { type: "move", at: sample(target, 5), layout },
      { type: "move", at: sample(target, 10), layout },
      { type: "up", at: sample(target, 15), layout },
    ]);

    expect(actions).toHaveLength(1);
    expect(actions[0]).toEqual({ type: "row/reorder", rowId: dragged, toIndex: 3 });
    expect(state.phase).toBe("idle");
  });

  it("emits nothing when a tier is dropped where it started", () => {
    const d = doc();
    const layout = layoutOf(d);
    const dragged = rowId(d, 2);
    const home = midpointOf(layout, 2);

    const { actions } = drive([
      { type: "down", rowId: dragged, at: sample(home), layout, immediate: true },
      { type: "move", at: sample(home + 20, 5), layout },
      { type: "move", at: sample(home, 10), layout },
      { type: "up", at: sample(home, 15), layout },
    ]);
    expect(actions).toEqual([]);
  });

  it("reads the drop from the release, not from the last move", () => {
    const d = doc();
    const layout = layoutOf(d);
    const dragged = rowId(d, 0);

    const { actions } = drive([
      { type: "down", rowId: dragged, at: sample(midpointOf(layout, 0)), layout, immediate: true },
      { type: "move", at: sample(midpointOf(layout, 1) + 1, 5), layout },
      // No move reports this position; the pointer lifts there.
      { type: "up", at: sample(99999, 10), layout },
    ]);
    expect(actions).toHaveLength(1);
    expect((actions[0] as { toIndex: number }).toIndex).toBe(layout.rows.length - 1);
  });

  it("commits nothing on cancel", () => {
    const d = doc();
    const layout = layoutOf(d);
    const { state, actions } = drive([
      { type: "down", rowId: rowId(d, 0), at: sample(10), layout, immediate: true },
      { type: "move", at: sample(400, 5), layout },
      { type: "cancel" },
    ]);
    expect(state.phase).toBe("idle");
    expect(actions).toEqual([]);
  });

  it("only ever emits row/reorder — a tier cannot land in the tray", () => {
    const d = doc();
    const layout = layoutOf(d);
    const dragged = rowId(d, 0);
    // Far below every tier, which for a *tile* would be the tray.
    const { actions } = drive([
      { type: "down", rowId: dragged, at: sample(midpointOf(layout, 0)), layout, immediate: true },
      { type: "move", at: sample(layout.contentHeight + 500, 5), layout },
      { type: "up", at: sample(layout.contentHeight + 500, 10), layout },
    ]);
    expect(actions).toHaveLength(1);
    expect(actions[0]!.type).toBe("row/reorder");
  });

  /**
   * A reorder must survive being applied: the index the machine emits is an
   * index into `doc.rows` after the dragged row is spliced out, which is what
   * `row/reorder` clamps and inserts at. Driving the action through the real
   * reducer is the only thing that proves the two agree.
   */
  it("produces an index the reducer turns into the visually expected order", () => {
    const d = doc();
    const layout = layoutOf(d);
    const dragged = rowId(d, 0);
    const labelsBefore = [...d.rows].sort((a, b) => a.order - b.order).map((r) => r.label);

    const { actions } = drive([
      { type: "down", rowId: dragged, at: sample(midpointOf(layout, 0)), layout, immediate: true },
      { type: "move", at: sample(midpointOf(layout, 2) + 1, 5), layout },
      { type: "up", at: sample(midpointOf(layout, 2) + 1, 10), layout },
    ]);

    const after = reduce(d, actions[0]!, NOW);
    const labelsAfter = [...after.rows].sort((a, b) => a.order - b.order).map((r) => r.label);

    // The dragged tier moved to position 2; the two it passed shifted up.
    const expected = [...labelsBefore];
    const [moved] = expected.splice(0, 1);
    expected.splice(2, 0, moved!);
    expect(labelsAfter).toEqual(expected);
  });
});
