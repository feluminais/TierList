import { defaultImageEdit } from "@tl/core";
import { describe, expect, it } from "vitest";
import { editReduce, idleEdit, type EditState } from "../src/imageedit";

const TILE = { x: 0, y: 0, width: 100, height: 100 };
const BASE = { ...defaultImageEdit(), crop: { x: 0, y: 0, w: 1, h: 1 } };
const CONTEXT = { itemId: "i1", tile: TILE, edit: BASE, tolerance: 0.001 };

const pen = (overrides: Partial<typeof CONTEXT> = {}) => ({
  ...CONTEXT,
  ...overrides,
});

describe("editReduce — pen", () => {
  it("starts a stroke on down and emits nothing", () => {
    const out = editReduce(idleEdit(), {
      type: "penDown",
      at: { x: 10, y: 10 },
      context: pen(),
      strokeId: "s1",
      color: "#fff",
      width: 2,
    });
    expect(out.state.phase).toBe("drawing");
    expect(out.action).toBeNull();
  });

  it("collects points on move and still emits nothing", () => {
    let state: EditState = idleEdit();
    state = editReduce(state, {
      type: "penDown",
      at: { x: 10, y: 10 },
      context: pen(),
      strokeId: "s1",
      color: "#fff",
      width: 2,
    }).state;
    for (const x of [20, 30, 40]) {
      const out = editReduce(state, { type: "penMove", at: { x, y: 10 }, context: pen() });
      state = out.state;
      expect(out.action).toBeNull();
    }
    expect(state.phase).toBe("drawing");
  });

  // The whole point of the machine: one gesture is one action, one undo step,
  // one revision and one autosave.
  it("emits exactly one item/setEdit when the stroke ends", () => {
    let state: EditState = idleEdit();
    state = editReduce(state, {
      type: "penDown",
      at: { x: 0, y: 0 },
      context: pen(),
      strokeId: "s1",
      color: "#4ade80",
      width: 3,
    }).state;
    for (const x of [25, 50, 75]) {
      state = editReduce(state, { type: "penMove", at: { x, y: 0 }, context: pen() }).state;
    }
    const out = editReduce(state, { type: "penUp", at: { x: 100, y: 0 }, context: pen() });

    expect(out.state.phase).toBe("idle");
    expect(out.action?.type).toBe("item/setEdit");
    const action = out.action as { type: "item/setEdit"; itemId: string; edit: typeof BASE };
    expect(action.itemId).toBe("i1");
    expect(action.edit.strokes).toHaveLength(1);
    expect(action.edit.strokes[0]!.id).toBe("s1");
    expect(action.edit.strokes[0]!.color).toBe("#4ade80");
    expect(action.edit.strokes[0]!.width).toBe(3);
  });

  it("keeps strokes the edit already had", () => {
    const existing = {
      ...BASE,
      strokes: [{ id: "old", points: [0, 0, 1, 1], color: "#000", width: 1 }],
    };
    let state: EditState = idleEdit();
    state = editReduce(state, {
      type: "penDown",
      at: { x: 0, y: 0 },
      context: pen({ edit: existing }),
      strokeId: "s2",
      color: "#fff",
      width: 2,
    }).state;
    const out = editReduce(state, {
      type: "penUp",
      at: { x: 50, y: 50 },
      context: pen({ edit: existing }),
    });
    const action = out.action as { edit: typeof existing };
    expect(action.edit.strokes.map((s) => s.id)).toEqual(["old", "s2"]);
  });

  // A tap is not a drawing. Emitting a one-point stroke would put an
  // invisible mark in the document and an undo step on the stack.
  it("emits nothing for a stroke that never moved", () => {
    let state: EditState = idleEdit();
    state = editReduce(state, {
      type: "penDown",
      at: { x: 10, y: 10 },
      context: pen(),
      strokeId: "s1",
      color: "#fff",
      width: 2,
    }).state;
    const out = editReduce(state, { type: "penUp", at: { x: 10, y: 10 }, context: pen() });
    expect(out.action).toBeNull();
    expect(out.state.phase).toBe("idle");
  });

  it("abandons the stroke on cancel", () => {
    let state: EditState = idleEdit();
    state = editReduce(state, {
      type: "penDown",
      at: { x: 0, y: 0 },
      context: pen(),
      strokeId: "s1",
      color: "#fff",
      width: 2,
    }).state;
    state = editReduce(state, { type: "penMove", at: { x: 50, y: 50 }, context: pen() }).state;
    const out = editReduce(state, { type: "cancel" });
    expect(out.state.phase).toBe("idle");
    expect(out.action).toBeNull();
  });

  it("ignores a move that arrives while idle", () => {
    const out = editReduce(idleEdit(), { type: "penMove", at: { x: 5, y: 5 }, context: pen() });
    expect(out.state.phase).toBe("idle");
    expect(out.action).toBeNull();
  });

  it("ignores an up that arrives while idle", () => {
    const out = editReduce(idleEdit(), { type: "penUp", at: { x: 5, y: 5 }, context: pen() });
    expect(out.action).toBeNull();
  });

  it("stores stroke points in source space, not tile space", () => {
    const cropped = { ...BASE, crop: { x: 0.5, y: 0.5, w: 0.5, h: 0.5 } };
    let state: EditState = idleEdit();
    state = editReduce(state, {
      type: "penDown",
      at: { x: 0, y: 0 },
      context: pen({ edit: cropped }),
      strokeId: "s1",
      color: "#fff",
      width: 2,
    }).state;
    const out = editReduce(state, {
      type: "penUp",
      at: { x: 100, y: 100 },
      context: pen({ edit: cropped }),
    });
    const action = out.action as { edit: typeof cropped };
    // The tile's corners map to the crop's corners: (0.5,0.5) to (1,1).
    expect(action.edit.strokes[0]!.points).toEqual([0.5, 0.5, 1, 1]);
  });

  // A stroke that moves away from its start and comes back to exactly the
  // same point is a closed loop, not a tap: real drawing happened between the
  // endpoints even though the first and last point coincide. `isDrawable`
  // must not conclude "never moved" just because start == end.
  it("treats a closed loop that returns to its start as drawable", () => {
    let state: EditState = idleEdit();
    state = editReduce(state, {
      type: "penDown",
      at: { x: 0, y: 0 },
      context: pen(),
      strokeId: "loop",
      color: "#fff",
      width: 2,
    }).state;
    state = editReduce(state, { type: "penMove", at: { x: 50, y: 50 }, context: pen() }).state;
    const out = editReduce(state, { type: "penUp", at: { x: 0, y: 0 }, context: pen() });
    expect(out.action).not.toBeNull();
    expect(out.action?.type).toBe("item/setEdit");
  });

  // The context's `edit` is read fresh from each event, not captured at
  // penDown, so a document that changed underneath the gesture (an autosave
  // landing, an undo elsewhere) is not clobbered by a stale snapshot.
  it("commits against the edit delivered with penUp, not the one captured at penDown", () => {
    const atDown = {
      ...BASE,
      strokes: [{ id: "existing", points: [0, 0, 0.2, 0.2], color: "#111", width: 1 }],
    };
    // A different edit arrives by the time the gesture ends — as if another
    // stroke landed, or the document moved, mid-gesture.
    const atUp = {
      ...BASE,
      strokes: [
        { id: "existing", points: [0, 0, 0.2, 0.2], color: "#111", width: 1 },
        { id: "mid-gesture", points: [0.3, 0.3, 0.4, 0.4], color: "#222", width: 1 },
      ],
    };
    let state: EditState = idleEdit();
    state = editReduce(state, {
      type: "penDown",
      at: { x: 0, y: 0 },
      context: pen({ edit: atDown }),
      strokeId: "s-new",
      color: "#fff",
      width: 2,
    }).state;
    const out = editReduce(state, {
      type: "penUp",
      at: { x: 100, y: 100 },
      context: pen({ edit: atUp }),
    });
    const action = out.action as { edit: typeof atUp };
    expect(action.edit.strokes.map((s) => s.id)).toEqual(["existing", "mid-gesture", "s-new"]);
  });

  // A second finger touching down mid-stroke — no intervening penUp. Pin
  // whatever the machine actually does so the behaviour is documented rather
  // than discovered later.
  it("a second penDown while already drawing replaces the in-progress stroke", () => {
    let state: EditState = idleEdit();
    state = editReduce(state, {
      type: "penDown",
      at: { x: 0, y: 0 },
      context: pen(),
      strokeId: "first",
      color: "#111",
      width: 1,
    }).state;
    state = editReduce(state, { type: "penMove", at: { x: 50, y: 0 }, context: pen() }).state;

    // Second finger touches down before the first lifts.
    const afterSecondDown = editReduce(state, {
      type: "penDown",
      at: { x: 20, y: 20 },
      context: pen(),
      strokeId: "second",
      color: "#222",
      width: 2,
    });
    expect(afterSecondDown.action).toBeNull();
    expect(afterSecondDown.state).toEqual({
      phase: "drawing",
      strokeId: "second",
      color: "#222",
      width: 2,
      points: [0.2, 0.2],
    });

    const out = editReduce(afterSecondDown.state, {
      type: "penUp",
      at: { x: 80, y: 80 },
      context: pen(),
    });
    const action = out.action as { edit: typeof BASE };
    // Only the second stroke was committed; the first's points are gone.
    expect(action.edit.strokes.map((s) => s.id)).toEqual(["second"]);
  });
});
