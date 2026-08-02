import { defaultImageEdit, type TierListAction } from "@tl/core";
import { describe, expect, it } from "vitest";
import {
  cropCenter,
  cropReduce,
  idleCrop,
  maxZoomFor,
  zoomCropTo,
  zoomOf,
  type Crop,
  type CropContext,
  type CropState,
} from "../src/crop";

/**
 * Nothing here is square, and that is the whole point.
 *
 * A square tile cannot fail for a transposed x and y, and neither can a square
 * crop — this project has now paid for that three times, most recently with
 * five `toSourcePoint` tests that all passed against a transposed mutant. The
 * tile is 320x240, the crop is 0.5 wide by 0.25 tall, and it sits off-centre,
 * so every one of the four numbers a pan touches has a distinct value.
 */
const TILE = { x: 0, y: 0, width: 320, height: 240 };
const CROP: Crop = { x: 0.1, y: 0.2, w: 0.5, h: 0.25 };

function context(crop: Crop = CROP): CropContext {
  return { itemId: "i1", tile: TILE, edit: { ...defaultImageEdit(), crop } };
}

/** The crop a state is showing — its own if a gesture is in flight. */
function shown(state: CropState, fallback: Crop): Crop {
  return state.phase === "active" ? state.crop : fallback;
}

function setEdit(action: TierListAction | null) {
  expect(action).not.toBeNull();
  expect(action!.type).toBe("item/setEdit");
  return action as TierListAction & { type: "item/setEdit" };
}

describe("zoomOf", () => {
  it("reads 1 for a crop with a full-extent long axis, whatever the aspect", () => {
    expect(zoomOf({ x: 0, y: 0, w: 1, h: 1 })).toBe(1);
    expect(zoomOf({ x: 0, y: 0.125, w: 1, h: 0.75 })).toBe(1);
    expect(zoomOf({ x: 0.125, y: 0, w: 0.75, h: 1 })).toBe(1);
  });

  it("is the exact inverse of the factor zoomCropTo applied", () => {
    let crop = { x: 0.125, y: 0, w: 0.75, h: 1 };
    for (const target of [1.5, 3, 7.25, 2]) {
      crop = zoomCropTo(crop, target, cropCenter(crop));
      expect(zoomOf(crop)).toBeCloseTo(target, 10);
    }
  });

  it("does not throw on a degenerate crop", () => {
    expect(zoomOf({ x: 0, y: 0, w: 0, h: 0 })).toBe(50);
  });
});

describe("maxZoomFor", () => {
  it("is where zoomCropTo actually stops", () => {
    const crop = { x: 0.125, y: 0, w: 0.75, h: 1 };
    const max = maxZoomFor(crop);
    // Asking for far more than the ceiling lands exactly on it.
    const zoomed = zoomCropTo(crop, max * 10, cropCenter(crop));
    expect(zoomOf(zoomed)).toBeCloseTo(max, 8);
  });

  it("does not move as the crop zooms, so a control's end stop stays put", () => {
    const crop = { x: 0.125, y: 0, w: 0.75, h: 1 };
    const before = maxZoomFor(crop);
    const after = maxZoomFor(zoomCropTo(crop, 4, cropCenter(crop)));
    expect(after).toBeCloseTo(before, 8);
  });

  it("is lower for a lopsided crop, because its short axis floors first", () => {
    // A 4:1 crop reaches MIN_CROP on its height while its width still has room.
    expect(maxZoomFor({ x: 0, y: 0.375, w: 1, h: 0.25 })).toBeLessThan(
      maxZoomFor({ x: 0, y: 0, w: 1, h: 1 }),
    );
  });
});

describe("cropReduce — pan", () => {
  it("emits nothing on panStart and adopts the document's crop", () => {
    const out = cropReduce(idleCrop(), {
      type: "panStart",
      at: { x: 100, y: 100 },
      context: context(),
    });
    expect(out.action).toBeNull();
    expect(shown(out.state, CROP)).toEqual(CROP);
  });

  it("moves the crop opposite the pointer, scaled per axis", () => {
    let state = cropReduce(idleCrop(), {
      type: "panStart",
      at: { x: 100, y: 100 },
      context: context(),
    }).state;

    // +32px of 320 is a tenth of the tile's width, which is a tenth of the
    // crop's 0.5 width = 0.05 of the source. Dragging right moves the window
    // left. The vertical arm uses different numbers on purpose: +24px of 240
    // is a tenth of the height, a tenth of the crop's 0.25 = 0.025.
    const out = cropReduce(state, {
      type: "panMove",
      at: { x: 132, y: 124 },
      context: context(),
    });
    expect(out.action).toBeNull();
    const crop = shown(out.state, CROP);
    expect(crop.x).toBeCloseTo(0.05, 10);
    expect(crop.y).toBeCloseTo(0.175, 10);
    expect(crop.w).toBe(0.5);
    expect(crop.h).toBe(0.25);
    state = out.state;
  });

  it("does not transpose the axes", () => {
    // Move on x only. If the two axes' divisors were swapped, y would move too
    // — and with a non-square tile and a non-square crop it would move by a
    // different amount than x, so this cannot pass for the wrong reason.
    const state = cropReduce(idleCrop(), {
      type: "panStart",
      at: { x: 100, y: 100 },
      context: context(),
    }).state;
    const crop = shown(
      cropReduce(state, { type: "panMove", at: { x: 60, y: 100 }, context: context() }).state,
      CROP,
    );
    expect(crop.y).toBe(CROP.y);
    expect(crop.x).not.toBe(CROP.x);
  });

  it("accumulates across several moves rather than measuring from the start", () => {
    let state: CropState = idleCrop();
    state = cropReduce(state, { type: "panStart", at: { x: 200, y: 120 }, context: context() }).state;
    for (const x of [190, 180, 170, 160]) {
      state = cropReduce(state, { type: "panMove", at: { x, y: 120 }, context: context() }).state;
    }
    // 40px left over 320px of tile = 0.125 of the crop's 0.5 width = 0.0625.
    expect(shown(state, CROP).x).toBeCloseTo(CROP.x + 0.0625, 10);
  });

  it("commits exactly one item/setEdit at panEnd", () => {
    let state: CropState = idleCrop();
    state = cropReduce(state, { type: "panStart", at: { x: 200, y: 120 }, context: context() }).state;

    const moved = cropReduce(state, { type: "panMove", at: { x: 180, y: 108 }, context: context() });
    expect(moved.action).toBeNull();

    const ended = cropReduce(moved.state, {
      type: "panEnd",
      at: { x: 160, y: 96 },
      context: context(),
    });
    const action = setEdit(ended.action);
    expect(action.itemId).toBe("i1");
    expect(ended.state.phase).toBe("idle");
    // The travel from the last move is included, not dropped.
    expect(action.edit.crop.x).toBeCloseTo(CROP.x + 0.0625, 10);
    expect(action.edit.crop.y).toBeCloseTo(CROP.y + 0.025, 10);
  });

  it("emits nothing for a click that moved nothing", () => {
    const state = cropReduce(idleCrop(), {
      type: "panStart",
      at: { x: 100, y: 100 },
      context: context(),
    }).state;
    const out = cropReduce(state, { type: "panEnd", at: { x: 100, y: 100 }, context: context() });
    expect(out.action).toBeNull();
    expect(out.state.phase).toBe("idle");
  });

  it("ignores a move with no pan under way", () => {
    const out = cropReduce(idleCrop(), {
      type: "panMove",
      at: { x: 10, y: 10 },
      context: context(),
    });
    expect(out.state.phase).toBe("idle");
    expect(out.action).toBeNull();
  });

  it("keeps the crop inside the source at the edges", () => {
    let state: CropState = idleCrop();
    state = cropReduce(state, { type: "panStart", at: { x: 0, y: 0 }, context: context() }).state;
    const out = cropReduce(state, {
      type: "panEnd",
      at: { x: 100000, y: 100000 },
      context: context(),
    });
    const action = setEdit(out.action);
    expect(action.edit.crop.x).toBe(0);
    expect(action.edit.crop.y).toBe(0);
  });

  it("preserves everything else on the edit, including strokes", () => {
    const base = {
      ...defaultImageEdit(),
      crop: CROP,
      strokes: [{ id: "s1", points: [0, 0, 1, 1], color: "#fff", width: 2 }],
    };
    const ctx: CropContext = { itemId: "i1", tile: TILE, edit: base };
    let state: CropState = idleCrop();
    state = cropReduce(state, { type: "panStart", at: { x: 200, y: 120 }, context: ctx }).state;
    const action = setEdit(
      cropReduce(state, { type: "panEnd", at: { x: 100, y: 60 }, context: ctx }).action,
    );
    expect(action.edit.strokes).toEqual(base.strokes);
    expect(action.edit.rotation).toBe(base.rotation);
  });

  /**
   * The staleness contract `editReduce` documents, checked for this machine
   * too: an autosave or an undo can land mid-gesture, and the action must
   * carry the *current* edit with only the crop replaced.
   */
  it("builds its action from the context's edit, not the one the gesture started with", () => {
    let state: CropState = idleCrop();
    state = cropReduce(state, { type: "panStart", at: { x: 200, y: 120 }, context: context() }).state;
    state = cropReduce(state, { type: "panMove", at: { x: 160, y: 120 }, context: context() }).state;

    const moved: CropContext = {
      itemId: "i1",
      tile: TILE,
      edit: {
        ...defaultImageEdit(),
        crop: CROP,
        strokes: [{ id: "landed-during", points: [0, 0, 1, 1], color: "#f00", width: 1 }],
      },
    };
    const action = setEdit(
      cropReduce(state, { type: "panEnd", at: { x: 160, y: 120 }, context: moved }).action,
    );
    expect(action.edit.strokes.map((s) => s.id)).toEqual(["landed-during"]);
  });
});

describe("cropReduce — zoom", () => {
  it("zooms about the point under the pointer and emits nothing until zoomEnd", () => {
    const out = cropReduce(idleCrop(), {
      type: "zoomBy",
      factor: 2,
      at: { x: 160, y: 120 },
      context: context(),
    });
    expect(out.action).toBeNull();
    const crop = shown(out.state, CROP);
    expect(crop.w).toBeCloseTo(0.25, 10);
    expect(crop.h).toBeCloseTo(0.125, 10);
    // The tile's centre maps to the crop's centre, which must not have moved.
    expect(cropCenter(crop).x).toBeCloseTo(cropCenter(CROP).x, 10);
    expect(cropCenter(crop).y).toBeCloseTo(cropCenter(CROP).y, 10);
  });

  it("holds the source point under a corner still, not just the centre", () => {
    // A quarter across and three quarters down the tile — deliberately not on
    // either diagonal of symmetry.
    const at = { x: 80, y: 180 };
    const before = { x: CROP.x + 0.25 * CROP.w, y: CROP.y + 0.75 * CROP.h };
    const out = cropReduce(idleCrop(), { type: "zoomBy", factor: 2, at, context: context() });
    const crop = shown(out.state, CROP);
    expect(crop.x + 0.25 * crop.w).toBeCloseTo(before.x, 10);
    expect(crop.y + 0.75 * crop.h).toBeCloseTo(before.y, 10);
  });

  it("accumulates a run of notches and commits exactly one action at zoomEnd", () => {
    let state: CropState = idleCrop();
    for (let i = 0; i < 3; i++) {
      const out = cropReduce(state, {
        type: "zoomBy",
        factor: 1.2,
        at: { x: 160, y: 120 },
        context: context(),
      });
      expect(out.action).toBeNull();
      state = out.state;
    }
    const ended = cropReduce(state, { type: "zoomEnd", context: context() });
    const action = setEdit(ended.action);
    expect(ended.state.phase).toBe("idle");
    expect(action.edit.crop.w).toBeCloseTo(CROP.w / 1.2 ** 3, 10);
    expect(action.edit.crop.h).toBeCloseTo(CROP.h / 1.2 ** 3, 10);
  });

  it("zoomTo drives an absolute level about the crop's centre", () => {
    const out = cropReduce(idleCrop(), { type: "zoomTo", zoom: 4, context: context() });
    const crop = shown(out.state, CROP);
    expect(zoomOf(crop)).toBeCloseTo(4, 8);
    expect(cropCenter(crop).x).toBeCloseTo(cropCenter(CROP).x, 8);
    expect(cropCenter(crop).y).toBeCloseTo(cropCenter(CROP).y, 8);
  });

  it("emits nothing when a zoom run ends where it started", () => {
    let state = cropReduce(idleCrop(), {
      type: "zoomBy",
      factor: 2,
      at: { x: 160, y: 120 },
      context: context(),
    }).state;
    state = cropReduce(state, {
      type: "zoomBy",
      factor: 0.5,
      at: { x: 160, y: 120 },
      context: context(),
    }).state;
    expect(cropReduce(state, { type: "zoomEnd", context: context() }).action).toBeNull();
  });

  it("ignores zoomEnd with no gesture in flight", () => {
    const out = cropReduce(idleCrop(), { type: "zoomEnd", context: context() });
    expect(out.action).toBeNull();
    expect(out.state.phase).toBe("idle");
  });
});

describe("cropReduce — pan and zoom in one gesture", () => {
  it("zooms the working crop rather than restarting from the document", () => {
    let state: CropState = idleCrop();
    state = cropReduce(state, { type: "panStart", at: { x: 200, y: 120 }, context: context() }).state;
    state = cropReduce(state, { type: "panMove", at: { x: 160, y: 120 }, context: context() }).state;
    const panned = shown(state, CROP).x;

    state = cropReduce(state, {
      type: "zoomBy",
      factor: 2,
      at: { x: 160, y: 120 },
      context: context(),
    }).state;
    // Still zoomed about a crop that had already been panned: the width halved
    // *and* the pan survived, rather than the zoom rebuilding from CROP.
    expect(shown(state, CROP).w).toBeCloseTo(0.25, 10);
    expect(panned).not.toBeCloseTo(CROP.x, 6);
  });

  it("lets a zoomEnd arriving mid-pan defer to the pan's own commit", () => {
    let state: CropState = idleCrop();
    state = cropReduce(state, { type: "panStart", at: { x: 200, y: 120 }, context: context() }).state;
    state = cropReduce(state, {
      type: "zoomBy",
      factor: 2,
      at: { x: 200, y: 120 },
      context: context(),
    }).state;

    const deferred = cropReduce(state, { type: "zoomEnd", context: context() });
    expect(deferred.action).toBeNull();
    expect(deferred.state.phase).toBe("active");

    const ended = cropReduce(deferred.state, {
      type: "panEnd",
      at: { x: 180, y: 120 },
      context: context(),
    });
    const action = setEdit(ended.action);
    expect(action.edit.crop.w).toBeCloseTo(0.25, 10);
  });

  it("emits exactly one action for a whole pan-zoom-pan gesture", () => {
    const emitted: TierListAction[] = [];
    let state: CropState = idleCrop();
    const send = (event: Parameters<typeof cropReduce>[1]) => {
      const out = cropReduce(state, event);
      state = out.state;
      if (out.action) emitted.push(out.action);
    };

    send({ type: "panStart", at: { x: 200, y: 120 }, context: context() });
    send({ type: "panMove", at: { x: 190, y: 118 }, context: context() });
    send({ type: "zoomBy", factor: 1.4, at: { x: 190, y: 118 }, context: context() });
    send({ type: "panMove", at: { x: 175, y: 110 }, context: context() });
    send({ type: "panEnd", at: { x: 170, y: 105 }, context: context() });

    expect(emitted).toHaveLength(1);
  });

  it("throws nothing away on cancel", () => {
    let state: CropState = idleCrop();
    state = cropReduce(state, { type: "panStart", at: { x: 200, y: 120 }, context: context() }).state;
    state = cropReduce(state, { type: "panMove", at: { x: 100, y: 60 }, context: context() }).state;
    const out = cropReduce(state, { type: "cancel" });
    expect(out.state.phase).toBe("idle");
    expect(out.action).toBeNull();
  });
});
