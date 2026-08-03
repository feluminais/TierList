import { DEFAULT_STROKE_WIDTH, createTierList, reduce, type TierListAction } from "@tl/core";
import { describe, expect, it } from "vitest";
import {
  boardPenReduce,
  boardStrokePoints,
  boardStrokeWidth,
  idleBoardPen,
  type BoardPenContext,
  type BoardPenEvent,
  type BoardPenState,
} from "../src/boardpen";

const NOW = "2026-08-01T12:00:00.000Z";

/**
 * Deliberately not square, and not at the origin. A square board cannot fail
 * for a transposed x and y, and one at 0,0 cannot fail for a forgotten offset.
 */
const BOARD = { x: 20, y: 50, width: 800, height: 400 };
const CONTEXT: BoardPenContext = { board: BOARD, tolerance: 0.0005 };

function drive(events: BoardPenEvent[]): {
  state: BoardPenState;
  actions: TierListAction[];
} {
  let state: BoardPenState = idleBoardPen();
  const actions: TierListAction[] = [];
  for (const event of events) {
    const out = boardPenReduce(state, event);
    state = out.state;
    if (out.action) actions.push(out.action);
  }
  return { state, actions };
}

function down(x: number, y: number): BoardPenEvent {
  return {
    type: "penDown",
    at: { x, y },
    context: CONTEXT,
    strokeId: "s1",
    color: "#4ade80",
    width: DEFAULT_STROKE_WIDTH,
  };
}
const move = (x: number, y: number): BoardPenEvent => ({ type: "penMove", at: { x, y }, context: CONTEXT });
const up = (x: number, y: number): BoardPenEvent => ({ type: "penUp", at: { x, y }, context: CONTEXT });

function strokeFrom(action: TierListAction) {
  expect(action.type).toBe("board/addStroke");
  return (action as TierListAction & { type: "board/addStroke" }).stroke;
}

describe("boardPenReduce", () => {
  it("emits nothing until the gesture ends, then exactly one board/addStroke", () => {
    const { actions, state } = drive([
      down(20, 50),
      move(420, 150),
      move(620, 250),
      up(820, 450),
    ]);
    expect(actions).toHaveLength(1);
    expect(actions[0]!.type).toBe("board/addStroke");
    expect(state.phase).toBe("idle");
  });

  it("normalizes against the board, offset included", () => {
    // The board spans x 20..820 and y 50..450, so its own corners are 0 and 1.
    const stroke = strokeFrom(drive([down(20, 50), up(820, 450)]).actions[0]!);
    expect(stroke.points[0]).toBeCloseTo(0, 10);
    expect(stroke.points[1]).toBeCloseTo(0, 10);
    expect(stroke.points[2]).toBeCloseTo(1, 10);
    expect(stroke.points[3]).toBeCloseTo(1, 10);
  });

  it("does not transpose the axes", () => {
    // A quarter across and three quarters down — off both diagonals.
    const stroke = strokeFrom(drive([down(20, 50), up(220, 350)]).actions[0]!);
    expect(stroke.points[2]).toBeCloseTo(0.25, 10);
    expect(stroke.points[3]).toBeCloseTo(0.75, 10);
  });

  it("keeps the colour and width the gesture began with", () => {
    const stroke = strokeFrom(drive([down(20, 50), up(820, 450)]).actions[0]!);
    expect(stroke.color).toBe("#4ade80");
    expect(stroke.width).toBe(DEFAULT_STROKE_WIDTH);
    expect(stroke.id).toBe("s1");
  });

  it("emits nothing for a tap that never moved", () => {
    expect(drive([down(100, 100), up(100, 100)]).actions).toEqual([]);
  });

  it("emits nothing for a run of identical points", () => {
    expect(drive([down(100, 100), move(100, 100), up(100, 100)]).actions).toEqual([]);
  });

  it("ignores a move with no gesture under way", () => {
    const out = boardPenReduce(idleBoardPen(), move(100, 100));
    expect(out.state.phase).toBe("idle");
    expect(out.action).toBeNull();
  });

  it("ignores an up with no gesture under way", () => {
    const out = boardPenReduce(idleBoardPen(), up(100, 100));
    expect(out.action).toBeNull();
  });

  it("throws nothing away on cancel", () => {
    const { state, actions } = drive([down(100, 100), move(300, 200), { type: "cancel" }]);
    expect(state.phase).toBe("idle");
    expect(actions).toEqual([]);
  });

  it("keeps points a caller drew outside the board rather than clamping them", () => {
    // A pen that left the board is not an error; clamping would bunch points
    // against the edge and turn a mark running off the list into a smear.
    const stroke = strokeFrom(drive([down(20, 50), up(1220, 650)]).actions[0]!);
    expect(stroke.points[2]).toBeGreaterThan(1);
    expect(stroke.points[3]).toBeGreaterThan(1);
  });

  it("thins a straight run but keeps its ends", () => {
    const points: BoardPenEvent[] = [down(20, 50)];
    for (let x = 60; x <= 780; x += 20) points.push(move(x, 50));
    points.push(up(820, 50));

    const stroke = strokeFrom(drive(points).actions[0]!);
    expect(stroke.points.length / 2).toBeLessThan(38);
    expect(stroke.points[0]).toBeCloseTo(0, 10);
    expect(stroke.points[stroke.points.length - 2]).toBeCloseTo(1, 10);
  });

  /**
   * The board reflows as tiers are resized, so the surface a gesture began on
   * is not necessarily the one it ends on. The action is built from the
   * context of the event that commits it.
   */
  it("commits against the context of the final event, not the first", () => {
    const taller: BoardPenContext = {
      board: { x: 20, y: 50, width: 800, height: 800 },
      tolerance: 0.0005,
    };
    const { actions } = drive([
      down(20, 50),
      { type: "penUp", at: { x: 820, y: 850 }, context: taller },
    ]);
    // 850 is the bottom of the *taller* board, so it normalizes to 1.
    expect(strokeFrom(actions[0]!).points[3]).toBeCloseTo(1, 10);
  });
});

describe("boardStrokePoints / boardStrokeWidth", () => {
  it("round-trips a drawn mark back to where it was drawn", () => {
    const stroke = strokeFrom(drive([down(120, 150), up(620, 350)]).actions[0]!);
    const back = boardStrokePoints(stroke.points, BOARD);
    expect(back[0]).toBeCloseTo(120, 8);
    expect(back[1]).toBeCloseTo(150, 8);
    expect(back[back.length - 2]).toBeCloseTo(620, 8);
    expect(back[back.length - 1]).toBeCloseTo(350, 8);
  });

  it("scales a mark with the board rather than pinning it to pixels", () => {
    const stroke = strokeFrom(drive([down(420, 250), up(820, 450)]).actions[0]!);
    const wide = boardStrokePoints(stroke.points, { x: 0, y: 0, width: 1600, height: 800 });
    // Half way across a board of any width stays half way across.
    expect(wide[0]).toBeCloseTo(800, 6);
    expect(wide[1]).toBeCloseTo(400, 6);
  });

  it("reads the width as a fraction of the board's width", () => {
    expect(boardStrokeWidth(DEFAULT_STROKE_WIDTH, BOARD)).toBeCloseTo(16, 10);
    expect(boardStrokeWidth(DEFAULT_STROKE_WIDTH, { ...BOARD, width: 400 })).toBeCloseTo(8, 10);
  });
});

describe("board annotations through the reducer", () => {
  const base = () => createTierList({ id: "list-1", now: NOW });
  const stroke = (id: string) => ({
    id,
    points: [0.1, 0.2, 0.5, 0.6],
    color: "#fff",
    width: DEFAULT_STROKE_WIDTH,
  });

  it("appends rather than replacing, so two marks are two marks", () => {
    let doc = reduce(base(), { type: "board/addStroke", stroke: stroke("a") }, NOW);
    doc = reduce(doc, { type: "board/addStroke", stroke: stroke("b") }, NOW);
    expect(doc.boardAnnotations.map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("removes one by id", () => {
    let doc = reduce(base(), { type: "board/addStroke", stroke: stroke("a") }, NOW);
    doc = reduce(doc, { type: "board/addStroke", stroke: stroke("b") }, NOW);
    doc = reduce(doc, { type: "board/removeStroke", strokeId: "a" }, NOW);
    expect(doc.boardAnnotations.map((s) => s.id)).toEqual(["b"]);
  });

  it("does not bump the revision removing one that is not there", () => {
    const doc = reduce(base(), { type: "board/addStroke", stroke: stroke("a") }, NOW);
    expect(reduce(doc, { type: "board/removeStroke", strokeId: "nope" }, NOW)).toBe(doc);
  });

  it("clears every mark in one step", () => {
    let doc = reduce(base(), { type: "board/addStroke", stroke: stroke("a") }, NOW);
    doc = reduce(doc, { type: "board/addStroke", stroke: stroke("b") }, NOW);
    const cleared = reduce(doc, { type: "board/clearStrokes" }, NOW);
    expect(cleared.boardAnnotations).toEqual([]);
    expect(cleared.revision).toBe(doc.revision + 1);
  });

  it("does not bump the revision clearing nothing", () => {
    const doc = base();
    expect(reduce(doc, { type: "board/clearStrokes" }, NOW)).toBe(doc);
  });

  it("does not mutate the input document", () => {
    const doc = base();
    reduce(doc, { type: "board/addStroke", stroke: stroke("a") }, NOW);
    expect(doc.boardAnnotations).toEqual([]);
  });
});
