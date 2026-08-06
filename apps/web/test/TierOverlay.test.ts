import { createTierList, reduce, type TierList, type TierListAction } from "@tl/core";
import {
  MAX_LABEL_WIDTH,
  MAX_TILE_SIZE,
  MIN_LABEL_WIDTH,
  MIN_TILE_SIZE,
  layoutBoard,
} from "@tl/editor-core";
import { act, createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TierOverlay } from "../app/editor/TierOverlay";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = "2026-08-01T12:00:00.000Z";
const WIDTH = 800;

/**
 * jsdom lays nothing out, so a real `getBoundingClientRect` reports zeros.
 * `TierOverlay` reads only `left`/`top` off the wrapper to turn a client point
 * into board space, and 0/0 is exactly where the board's coordinate system
 * starts — so zero is faithful here rather than a fudge that happens to pass.
 */
Element.prototype.getBoundingClientRect = () => ({
  left: 0, top: 0, right: WIDTH, bottom: 0, width: WIDTH, height: 0, x: 0, y: 0,
  toJSON() {},
});

type CaptureCapable = Element & {
  setPointerCapture?: (id: number) => void;
  releasePointerCapture?: (id: number) => void;
  hasPointerCapture?: (id: number) => boolean;
};
const proto = Element.prototype as CaptureCapable;
if (!proto.setPointerCapture) proto.setPointerCapture = () => {};
if (!proto.releasePointerCapture) proto.releasePointerCapture = () => {};
if (!proto.hasPointerCapture) proto.hasPointerCapture = () => false;

afterEach(cleanup);

/**
 * Tiers of deliberately unequal height — two carry size overrides — so nothing
 * here can pass by assuming a uniform vertical step.
 */
function doc(): TierList {
  let d = createTierList({ id: "list-1", now: NOW });
  const ordered = [...d.rows].sort((a, b) => a.order - b.order);
  d = reduce(d, { type: "row/setTileSize", rowId: ordered[1]!.id, tileSize: 200 }, NOW);
  d = reduce(d, { type: "row/setTileSize", rowId: ordered[3]!.id, tileSize: 140 }, NOW);
  return d;
}

function ordered(d: TierList) {
  return [...d.rows].sort((a, b) => a.order - b.order);
}

function mount(d: TierList, onAction: (a: TierListAction) => void, immediate = true) {
  const onActions = vi.fn();
  render(
    createElement(TierOverlay, {
      doc: d,
      layout: layoutBoard(d, { width: WIDTH, trayAddSlot: true }),
      dragging: false,
      immediate,
      onAction,
      onActions,
      onAddRow: vi.fn(),
      onAddItem: vi.fn(),
    }),
  );
  return onActions;
}

/** The last batch the grip emitted, as a lookup by action type. */
function lastBatch(onActions: ReturnType<typeof vi.fn>): Record<string, any> {
  const calls = onActions.mock.calls;
  const batch = calls[calls.length - 1]![0] as { type: string }[];
  return Object.fromEntries(batch.map((action) => [action.type, action]));
}

/**
 * Open a tier's panel the way a user does: press and release on the tier
 * itself, without moving. There is no edit button — the tier *is* the control.
 */
function tapTier(rowId: string, at = { x: 40, y: 10 }) {
  const handle = handleFor(rowId);
  act(() => handle.dispatchEvent(pointer("pointerdown", at.x, at.y)));
  act(() => handle.dispatchEvent(pointer("pointerup", at.x, at.y)));
}

/** The tier handle for a row id. */
function handleFor(rowId: string): HTMLElement {
  const found = document
    .querySelectorAll<HTMLElement>('[data-testid="tier-handle"]')
    .values()
    .find((el) => el.dataset.rowId === rowId);
  if (!found) throw new Error(`no handle for ${rowId}`);
  return found;
}

function pointer(type: string, x: number, y: number): Event {
  // jsdom implements neither PointerEvent nor pointer capture; a MouseEvent
  // carries the clientX/clientY the overlay actually reads.
  return new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true });
}

/** The vertical midpoint of the tier at `index`, in board coordinates. */
function midpointOf(d: TierList, index: number): number {
  const row = layoutBoard(d, { width: WIDTH }).rows[index]!;
  return row.rect.y + row.rect.height / 2;
}

describe("TierOverlay — reorder by dragging a tier", () => {
  it("emits exactly one row/reorder for a drag onto another tier", () => {
    const d = doc();
    const onAction = vi.fn();
    mount(d, onAction);

    const dragged = ordered(d)[0]!.id;
    const handle = handleFor(dragged);

    act(() => handle.dispatchEvent(pointer("pointerdown", 40, midpointOf(d, 0))));
    act(() => handle.dispatchEvent(pointer("pointermove", 40, midpointOf(d, 3) + 1)));
    act(() => handle.dispatchEvent(pointer("pointerup", 40, midpointOf(d, 3) + 1)));

    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction.mock.calls[0]![0]).toEqual({
      type: "row/reorder",
      rowId: dragged,
      toIndex: 3,
    });
  });

  it("touches the document at no point before the drop", () => {
    const d = doc();
    const onAction = vi.fn();
    mount(d, onAction);
    const handle = handleFor(ordered(d)[0]!.id);

    act(() => handle.dispatchEvent(pointer("pointerdown", 40, midpointOf(d, 0))));
    act(() => handle.dispatchEvent(pointer("pointermove", 40, midpointOf(d, 2))));
    act(() => handle.dispatchEvent(pointer("pointermove", 40, midpointOf(d, 3))));

    expect(onAction).not.toHaveBeenCalled();
  });

  it("shows a caret while dragging and removes it on drop", () => {
    const d = doc();
    mount(d, vi.fn());
    const handle = handleFor(ordered(d)[0]!.id);

    expect(screen.queryByTestId("tier-caret")).toBeNull();

    act(() => handle.dispatchEvent(pointer("pointerdown", 40, midpointOf(d, 0))));
    act(() => handle.dispatchEvent(pointer("pointermove", 40, midpointOf(d, 2) + 1)));
    expect(screen.getByTestId("tier-caret")).not.toBeNull();

    act(() => handle.dispatchEvent(pointer("pointerup", 40, midpointOf(d, 2) + 1)));
    expect(screen.queryByTestId("tier-caret")).toBeNull();
  });

  it("emits nothing for a drag that ends where it began", () => {
    const d = doc();
    const onAction = vi.fn();
    mount(d, onAction);
    const handle = handleFor(ordered(d)[2]!.id);
    const home = midpointOf(d, 2);

    act(() => handle.dispatchEvent(pointer("pointerdown", 40, home)));
    act(() => handle.dispatchEvent(pointer("pointermove", 40, home + 30)));
    act(() => handle.dispatchEvent(pointer("pointerup", 40, home)));

    expect(onAction).not.toHaveBeenCalled();
  });

  it("emits nothing for a click that never moved", () => {
    const d = doc();
    const onAction = vi.fn();
    mount(d, onAction);
    const handle = handleFor(ordered(d)[0]!.id);

    act(() => handle.dispatchEvent(pointer("pointerdown", 40, midpointOf(d, 0))));
    act(() => handle.dispatchEvent(pointer("pointerup", 40, midpointOf(d, 0))));

    expect(onAction).not.toHaveBeenCalled();
  });

  /**
   * A tier can only ever be reordered. Dropping one below every tier — which
   * for a *tile* would mean the tray — must still land it among the tiers.
   */
  it("cannot drop a tier into the tray", () => {
    const d = doc();
    const onAction = vi.fn();
    mount(d, onAction);
    const handle = handleFor(ordered(d)[0]!.id);

    act(() => handle.dispatchEvent(pointer("pointerdown", 40, midpointOf(d, 0))));
    act(() => handle.dispatchEvent(pointer("pointermove", 40, 99999)));
    act(() => handle.dispatchEvent(pointer("pointerup", 40, 99999)));

    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction.mock.calls[0]![0]!.type).toBe("row/reorder");
  });
});

describe("TierOverlay — the panel opens from the tier itself", () => {
  it("shows no grip until the tier is hovered", () => {
    mount(doc(), vi.fn());
    expect(screen.queryByTestId("tier-resize-grip")).toBeNull();
  });

  it("reveals the grip on hover", () => {
    const d = doc();
    mount(d, vi.fn());
    act(() => fireEvent.mouseEnter(handleFor(ordered(d)[0]!.id)));

    expect(screen.getByTestId("tier-resize-grip")).not.toBeNull();
  });

  /**
   * There is no edit button any more, on either kind of pointer. A press that
   * did not become a drag is what opens the panel — and a mouse click is
   * exactly that, so gating this on touch (as it used to be) would leave a
   * desktop user with no way in at all.
   */
  it("opens the panel for the tier that was clicked, with a mouse", () => {
    const d = doc();
    mount(d, vi.fn());
    const target = ordered(d)[2]!;

    tapTier(target.id);

    expect(screen.getByTestId("tier-panel")).not.toBeNull();
    expect(screen.getByTestId<HTMLInputElement>("tier-panel-name").value).toBe(target.label);
  });

  it("opens the panel on a touch device too", () => {
    const d = doc();
    mount(d, vi.fn(), false);
    tapTier(ordered(d)[2]!.id);
    expect(screen.getByTestId("tier-panel")).not.toBeNull();
  });

  it("closes the panel when the same tier is clicked again", () => {
    const d = doc();
    mount(d, vi.fn());
    const target = ordered(d)[1]!;

    tapTier(target.id);
    expect(screen.queryByTestId("tier-panel")).not.toBeNull();
    tapTier(target.id);
    expect(screen.queryByTestId("tier-panel")).toBeNull();
  });

  /**
   * Clicking a *different* tier moves the panel there rather than closing it.
   * The outside-press listener must therefore not fire first and swallow the
   * open — which is why it exempts the tier cells.
   */
  it("moves the panel to another tier when that one is clicked", () => {
    const d = doc();
    mount(d, vi.fn());
    const first = ordered(d)[1]!;
    const second = ordered(d)[3]!;

    tapTier(first.id);
    expect(screen.getByTestId<HTMLInputElement>("tier-panel-name").value).toBe(first.label);

    tapTier(second.id);
    expect(screen.getByTestId("tier-panel")).not.toBeNull();
    expect(screen.getByTestId<HTMLInputElement>("tier-panel-name").value).toBe(second.label);
  });

  it("closes when the press lands anywhere else", () => {
    const d = doc();
    mount(d, vi.fn());
    tapTier(ordered(d)[2]!.id);
    expect(screen.queryByTestId("tier-panel")).not.toBeNull();

    act(() => {
      screen
        .getByTestId("tier-overlay-wrapper")
        .dispatchEvent(pointer("pointerdown", 600, 600));
    });
    expect(screen.queryByTestId("tier-panel")).toBeNull();
  });

  /**
   * The whole point of the exemption: the panel exists to be typed into and
   * clicked on, and a press on its own name field must not close it.
   */
  it("stays open when the press lands inside the panel", () => {
    const d = doc();
    mount(d, vi.fn());
    tapTier(ordered(d)[2]!.id);

    act(() => {
      screen.getByTestId("tier-panel-name").dispatchEvent(pointer("pointerdown", 10, 10));
    });
    expect(screen.queryByTestId("tier-panel")).not.toBeNull();
  });

  /**
   * The colour popover clamps itself to the viewport, so it can be positioned
   * outside the panel's own box while still being part of it. Containment in
   * the DOM is what "inside the panel" means, not overlap on screen.
   */
  it("stays open when the press lands in the colour picker", () => {
    const d = doc();
    mount(d, vi.fn());
    tapTier(ordered(d)[2]!.id);
    act(() => fireEvent.click(screen.getByTestId("tier-panel-color")));

    const swatch = screen.getAllByTestId("color-swatch")[3]!;
    act(() => swatch.dispatchEvent(pointer("pointerdown", 10, 10)));
    expect(screen.queryByTestId("tier-panel")).not.toBeNull();
  });

  it("renames, recolours and removes the tier the panel is open on", () => {
    const d = doc();
    const onAction = vi.fn();
    mount(d, onAction);
    const target = ordered(d)[1]!;

    tapTier(target.id);

    act(() => {
      fireEvent.change(screen.getByTestId("tier-panel-name"), { target: { value: "God" } });
    });
    expect(onAction).toHaveBeenCalledWith({
      type: "row/rename",
      rowId: target.id,
      label: "God",
    });

    // The colour button opens the picker; the picker is what carries swatches.
    act(() => fireEvent.click(screen.getByTestId("tier-panel-color")));
    act(() => fireEvent.click(screen.getAllByTestId("color-swatch")[5]!));
    expect(onAction).toHaveBeenCalledWith(
      expect.objectContaining({ type: "row/recolor", rowId: target.id }),
    );
    // Picking closes it again.
    expect(screen.queryByTestId("color-popover")).toBeNull();

    act(() => fireEvent.click(screen.getByTestId("tier-panel-remove")));
    expect(onAction).toHaveBeenCalledWith({ type: "row/remove", rowId: target.id });
    expect(screen.queryByTestId("tier-panel")).toBeNull();
  });

  /** Sizing is a gesture on the board, never a control in the panel. */
  it("offers no size controls", () => {
    const d = doc();
    mount(d, vi.fn());
    tapTier(ordered(d)[2]!.id);

    expect(screen.queryByTestId("tier-panel-size")).toBeNull();
    expect(screen.queryByTestId("tier-panel-resize-all")).toBeNull();
  });

  /**
   * The panel opens out of the tier towards the page margin, and which side has
   * room is a question about where the *board* sits in the viewport — not about
   * the board's own coordinates, where every tier's label starts at x 0 whatever
   * the window size. Deciding it from `labelRect.x` compiles, type-checks and is
   * always wrong in the same direction.
   */
  it("opens towards the side that has room, measured on the page", () => {
    const d = doc();
    const original = Element.prototype.getBoundingClientRect;

    // A board pushed well to the right: there is room to its left.
    Element.prototype.getBoundingClientRect = function () {
      return { left: 500, top: 0, right: 500 + WIDTH, bottom: 0, width: WIDTH, height: 0, x: 500, y: 0, toJSON() {} } as DOMRect;
    };
    mount(d, vi.fn());
    tapTier(ordered(d)[0]!.id);
    // Placed to the left of the label cell, which starts at board x 0, so its
    // own left is negative — out into the page margin beside the board.
    expect(Number.parseFloat(screen.getByTestId("tier-panel").style.left)).toBeLessThan(0);
    expect(screen.getByTestId("tier-panel").style.animation).toContain("tl-tier-panel-in-left");
    cleanup();

    // A board hard against the left edge: it has to open the other way.
    Element.prototype.getBoundingClientRect = function () {
      return { left: 0, top: 0, right: WIDTH, bottom: 0, width: WIDTH, height: 0, x: 0, y: 0, toJSON() {} } as DOMRect;
    };
    mount(d, vi.fn());
    tapTier(ordered(d)[0]!.id);
    // Placed past the label cell's right edge instead.
    expect(Number.parseFloat(screen.getByTestId("tier-panel").style.left)).toBeGreaterThan(0);
    expect(screen.getByTestId("tier-panel").style.animation).toContain("tl-tier-panel-in-right");

    Element.prototype.getBoundingClientRect = original;
  });

  it("closes on Escape", () => {
    const d = doc();
    mount(d, vi.fn());
    tapTier(ordered(d)[0]!.id);

    act(() => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    expect(screen.queryByTestId("tier-panel")).toBeNull();
  });
});

describe("TierOverlay — the corner grip resizes both ways", () => {
  /**
   * Never the first tier, anywhere in this block.
   *
   * A grip that ignored its own row and always wrote to `rows[0]` — which is
   * exactly the failure this control was rebuilt to fix — passes every
   * assertion made against the first tier. It is the same trap as a square
   * fixture that cannot fail for a transposed x and y.
   */
  const GRIP_TIER = 2;

  function gripOn(d: TierList, index: number, onAction = vi.fn()) {
    const row = ordered(d)[index]!;
    const onActions = mount(d, onAction, true);
    act(() => fireEvent.mouseEnter(handleFor(row.id)));
    const grip = handleFor(row.id).querySelector<HTMLElement>(
      '[data-testid="tier-resize-grip"]',
    )!;
    return { row, grip, onActions, onAction };
  }

  /**
   * The bug this was rebuilt for: both axes fed one number, so a horizontal
   * pull only ever made the row taller and the label cell never widened.
   *
   * The two deltas are deliberately different, and the tier under test carries
   * its own size override — so a grip that swapped the axes, or that read the
   * list-wide size instead, lands on a different number than a correct one.
   */
  it("maps horizontal travel to the label column and vertical to the tier", () => {
    const d = doc();
    const { row, grip, onActions } = gripOn(d, 1);
    expect(row.tileSizeOverride).toBe(200);

    act(() => grip.dispatchEvent(pointer("pointerdown", 100, 100)));
    // Different deltas on the two axes, and neither reaches a clamp: a grip
    // that transposed them would land on the other number.
    act(() => grip.dispatchEvent(pointer("pointermove", 130, 120)));

    const batch = lastBatch(onActions);
    expect(batch["display/set"]).toEqual({
      type: "display/set",
      patch: { labelWidth: d.display.labelWidth + 30 },
    });
    expect(batch["row/setTileSize"]).toEqual({
      type: "row/setTileSize",
      rowId: row.id,
      tileSize: 220,
    });
  });

  it("moves only the axis that moved", () => {
    const d = doc();
    const { grip, onActions } = gripOn(d, GRIP_TIER);

    act(() => grip.dispatchEvent(pointer("pointerdown", 100, 100)));
    act(() => grip.dispatchEvent(pointer("pointermove", 100, 160)));

    const batch = lastBatch(onActions);
    expect(batch["display/set"].patch.labelWidth).toBe(d.display.labelWidth);
    expect(batch["row/setTileSize"].tileSize).toBe(d.display.tileSize + 60);
  });

  /**
   * One gesture, one undo step. Two dispatches would be two steps, and a run of
   * them alternating between two merge keys would coalesce into neither — which
   * is why the grip emits a batch rather than calling `onAction` twice.
   */
  it("emits one batch per move, and never a bare action", () => {
    const d = doc();
    const { grip, onActions, onAction } = gripOn(d, GRIP_TIER);

    act(() => grip.dispatchEvent(pointer("pointerdown", 100, 100)));
    act(() => grip.dispatchEvent(pointer("pointermove", 120, 120)));
    act(() => grip.dispatchEvent(pointer("pointermove", 140, 140)));

    expect(onActions).toHaveBeenCalledTimes(2);
    expect(onAction).not.toHaveBeenCalled();
    for (const [batch] of onActions.mock.calls) {
      expect(batch.map((a: { type: string }) => a.type)).toEqual([
        "display/set",
        "row/setTileSize",
      ]);
    }
  });

  it("resizes the tier it belongs to, not the first one", () => {
    const d = doc();
    const { row, grip, onActions } = gripOn(d, 3);
    expect(row.id).not.toBe(ordered(d)[0]!.id);

    act(() => grip.dispatchEvent(pointer("pointerdown", 100, 100)));
    act(() => grip.dispatchEvent(pointer("pointermove", 130, 130)));

    expect(lastBatch(onActions)["row/setTileSize"].rowId).toBe(row.id);
  });

  it("measures from where the drag began, not from the previous frame", () => {
    const d = doc();
    const { grip, onActions } = gripOn(d, GRIP_TIER);

    act(() => grip.dispatchEvent(pointer("pointerdown", 100, 100)));
    act(() => grip.dispatchEvent(pointer("pointermove", 140, 140)));
    expect(lastBatch(onActions)["row/setTileSize"].tileSize).toBe(d.display.tileSize + 40);

    act(() => grip.dispatchEvent(pointer("pointermove", 160, 160)));
    expect(lastBatch(onActions)["row/setTileSize"].tileSize).toBe(d.display.tileSize + 60);
  });

  it("clamps both axes beyond their allowed ranges", () => {
    const d = doc();
    const { grip, onActions } = gripOn(d, GRIP_TIER);

    act(() => grip.dispatchEvent(pointer("pointerdown", 100, 100)));
    act(() => grip.dispatchEvent(pointer("pointermove", 9000, 9000)));
    let batch = lastBatch(onActions);
    expect(batch["row/setTileSize"].tileSize).toBe(MAX_TILE_SIZE);
    expect(batch["display/set"].patch.labelWidth).toBe(MAX_LABEL_WIDTH);

    act(() => grip.dispatchEvent(pointer("pointermove", -9000, -9000)));
    batch = lastBatch(onActions);
    expect(batch["row/setTileSize"].tileSize).toBe(MIN_TILE_SIZE);
    expect(batch["display/set"].patch.labelWidth).toBe(MIN_LABEL_WIDTH);
  });

  it("grip drags do not start a reorder", () => {
    const d = doc();
    const onAction = vi.fn();
    const { grip } = gripOn(d, GRIP_TIER, onAction);

    act(() => grip.dispatchEvent(pointer("pointerdown", 100, 100)));
    act(() => grip.dispatchEvent(pointer("pointermove", 140, 400)));
    act(() => grip.dispatchEvent(pointer("pointerup", 140, 400)));

    for (const call of onAction.mock.calls) {
      expect(call[0].type).not.toBe("row/reorder");
    }
  });

  /**
   * The grip sits inside the tier cell, and a press that arms the cell and then
   * releases is a *tap* — which now opens the panel on either kind of pointer.
   * So a grip drag that reached the cell would end with the panel flying open
   * over the tier the user was resizing.
   */
  it("a grip drag does not open the panel", () => {
    const d = doc();
    const { grip } = gripOn(d, GRIP_TIER);

    act(() => grip.dispatchEvent(pointer("pointerdown", 100, 100)));
    act(() => grip.dispatchEvent(pointer("pointermove", 130, 130)));
    act(() => grip.dispatchEvent(pointer("pointerup", 130, 130)));

    expect(screen.queryByTestId("tier-panel")).toBeNull();
  });
});
