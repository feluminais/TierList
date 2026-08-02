import { createTierList, reduce, type TierList, type TierListAction } from "@tl/core";
import { layoutBoard } from "@tl/editor-core";
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
  render(
    createElement(TierOverlay, {
      doc: d,
      width: WIDTH,
      dragging: false,
      immediate,
      onAction,
      onAddRow: vi.fn(),
    }),
  );
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

describe("TierOverlay — the edit button and panel", () => {
  it("shows no affordances until the tier is hovered", () => {
    mount(doc(), vi.fn());
    expect(screen.queryByTestId("tier-edit-button")).toBeNull();
    expect(screen.queryByTestId("tier-resize-grip")).toBeNull();
  });

  it("reveals the edit button and grip on hover", () => {
    const d = doc();
    mount(d, vi.fn());
    act(() => fireEvent.mouseEnter(handleFor(ordered(d)[0]!.id)));

    expect(screen.getByTestId("tier-edit-button")).not.toBeNull();
    expect(screen.getByTestId("tier-resize-grip")).not.toBeNull();
  });

  it("opens the panel for the tier whose button was clicked", () => {
    const d = doc();
    mount(d, vi.fn());
    const target = ordered(d)[2]!;

    act(() => fireEvent.mouseEnter(handleFor(target.id)));
    act(() => fireEvent.click(screen.getByTestId("tier-edit-button")));

    expect(screen.getByTestId("tier-panel")).not.toBeNull();
    expect(screen.getByTestId<HTMLInputElement>("tier-panel-name").value).toBe(target.label);
  });

  it("closes the panel again when the same button is clicked", () => {
    const d = doc();
    mount(d, vi.fn());
    act(() => fireEvent.mouseEnter(handleFor(ordered(d)[0]!.id)));

    act(() => fireEvent.click(screen.getByTestId("tier-edit-button")));
    expect(screen.queryByTestId("tier-panel")).not.toBeNull();
    act(() => fireEvent.click(screen.getByTestId("tier-edit-button")));
    expect(screen.queryByTestId("tier-panel")).toBeNull();
  });

  /**
   * The button sits inside the drag handle, so its press must not also start a
   * reorder — otherwise opening the panel would arm a gesture that commits on
   * the way out.
   */
  it("clicking the edit button starts no drag", () => {
    const d = doc();
    const onAction = vi.fn();
    mount(d, onAction);
    act(() => fireEvent.mouseEnter(handleFor(ordered(d)[0]!.id)));

    const button = screen.getByTestId("tier-edit-button");
    act(() => button.dispatchEvent(pointer("pointerdown", 40, 10)));
    act(() => button.dispatchEvent(pointer("pointermove", 40, midpointOf(d, 3))));
    act(() => button.dispatchEvent(pointer("pointerup", 40, midpointOf(d, 3))));

    expect(onAction).not.toHaveBeenCalled();
  });

  it("renames, recolours and removes the tier the panel is open on", () => {
    const d = doc();
    const onAction = vi.fn();
    mount(d, onAction);
    const target = ordered(d)[1]!;

    act(() => fireEvent.mouseEnter(handleFor(target.id)));
    act(() => fireEvent.click(screen.getByTestId("tier-edit-button")));

    act(() => {
      fireEvent.change(screen.getByTestId("tier-panel-name"), { target: { value: "God" } });
    });
    expect(onAction).toHaveBeenCalledWith({
      type: "row/rename",
      rowId: target.id,
      label: "God",
    });

    act(() => fireEvent.click(screen.getAllByTestId("tier-panel-swatch")[3]!));
    expect(onAction).toHaveBeenCalledWith(
      expect.objectContaining({ type: "row/recolor", rowId: target.id }),
    );

    act(() => fireEvent.click(screen.getByTestId("tier-panel-remove")));
    expect(onAction).toHaveBeenCalledWith({ type: "row/remove", rowId: target.id });
    expect(screen.queryByTestId("tier-panel")).toBeNull();
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
    act(() => fireEvent.mouseEnter(handleFor(ordered(d)[0]!.id)));
    act(() => fireEvent.click(screen.getByTestId("tier-edit-button")));
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
    act(() => fireEvent.mouseEnter(handleFor(ordered(d)[0]!.id)));
    act(() => fireEvent.click(screen.getByTestId("tier-edit-button")));
    // Placed past the label cell's right edge instead.
    expect(Number.parseFloat(screen.getByTestId("tier-panel").style.left)).toBeGreaterThan(0);
    expect(screen.getByTestId("tier-panel").style.animation).toContain("tl-tier-panel-in-right");

    Element.prototype.getBoundingClientRect = original;
  });

  it("closes on Escape", () => {
    const d = doc();
    mount(d, vi.fn());
    act(() => fireEvent.mouseEnter(handleFor(ordered(d)[0]!.id)));
    act(() => fireEvent.click(screen.getByTestId("tier-edit-button")));

    act(() => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    expect(screen.queryByTestId("tier-panel")).toBeNull();
  });
});

describe("TierOverlay — sizing", () => {
  function openPanelOn(d: TierList, index: number, onAction: (a: TierListAction) => void) {
    mount(d, onAction);
    const row = ordered(d)[index]!;
    act(() => fireEvent.mouseEnter(handleFor(row.id)));
    act(() => fireEvent.click(screen.getByTestId("tier-edit-button")));
    return row;
  }

  it("the panel slider resizes only its own tier", () => {
    const d = doc();
    const onAction = vi.fn();
    const row = openPanelOn(d, 2, onAction);

    act(() => {
      fireEvent.change(screen.getByTestId("tier-panel-size"), { target: { value: "150" } });
    });

    expect(onAction).toHaveBeenCalledWith({
      type: "row/setTileSize",
      rowId: row.id,
      tileSize: 150,
    });
  });

  it("shows the tier's own size, not the list-wide one, when it has an override", () => {
    const d = doc();
    // Index 1 carries a 200px override.
    openPanelOn(d, 1, vi.fn());
    expect(screen.getByTestId("tier-panel-size-value").textContent).toBe("200");
  });

  /**
   * Never the first tier, anywhere in this block.
   *
   * A grip that ignored its own row and always wrote to `rows[0]` — which is
   * exactly the failure this control was rebuilt to fix — passes every
   * assertion made against the first tier. It is the same trap as a square
   * fixture that cannot fail for a transposed x and y.
   */
  const GRIP_TIER = 2;

  it("resizes the tier it belongs to, not the first one", () => {
    const d = doc();
    const onAction = vi.fn();
    const row = ordered(d)[3]!;
    expect(row.id).not.toBe(ordered(d)[0]!.id);

    mount(d, onAction);
    act(() => fireEvent.mouseEnter(handleFor(row.id)));
    const grip = screen.getByTestId("tier-resize-grip");

    act(() => grip.dispatchEvent(pointer("pointerdown", 100, 100)));
    act(() => grip.dispatchEvent(pointer("pointermove", 130, 130)));

    const last = onAction.mock.calls[onAction.mock.calls.length - 1]![0] as {
      rowId: string;
    };
    expect(last.rowId).toBe(row.id);
  });

  it("starts from the tier's own size, not the list-wide one", () => {
    const d = doc();
    const onAction = vi.fn();
    // Index 1 carries a 200px override while the list-wide size is 96.
    const row = ordered(d)[1]!;
    expect(row.tileSizeOverride).toBe(200);

    mount(d, onAction);
    act(() => fireEvent.mouseEnter(handleFor(row.id)));
    const grip = screen.getByTestId("tier-resize-grip");

    act(() => grip.dispatchEvent(pointer("pointerdown", 100, 100)));
    act(() => grip.dispatchEvent(pointer("pointermove", 120, 120)));

    expect(onAction).toHaveBeenLastCalledWith({
      type: "row/setTileSize",
      rowId: row.id,
      tileSize: 220,
    });
  });

  it("clamps a size beyond the allowed range", () => {
    const d = doc();
    const onAction = vi.fn();
    const row = openPanelOn(d, GRIP_TIER, onAction);
    // The range input clamps its own value, so drive the grip instead, which
    // takes an unbounded pointer delta.
    act(() => fireEvent.mouseEnter(handleFor(row.id)));
    const grip = screen.getByTestId("tier-resize-grip");

    act(() => grip.dispatchEvent(pointer("pointerdown", 100, 100)));
    act(() => grip.dispatchEvent(pointer("pointermove", 9000, 9000)));

    const last = onAction.mock.calls[onAction.mock.calls.length - 1]![0] as {
      tileSize: number;
    };
    expect(last.tileSize).toBe(240);

    act(() => grip.dispatchEvent(pointer("pointermove", -9000, -9000)));
    const low = onAction.mock.calls[onAction.mock.calls.length - 1]![0] as { tileSize: number };
    expect(low.tileSize).toBe(48);
  });

  it("the corner grip resizes its own tier, and measures from where the drag began", () => {
    const d = doc();
    const onAction = vi.fn();
    const row = ordered(d)[GRIP_TIER]!;
    mount(d, onAction);
    act(() => fireEvent.mouseEnter(handleFor(row.id)));
    const grip = screen.getByTestId("tier-resize-grip");

    act(() => grip.dispatchEvent(pointer("pointerdown", 100, 100)));
    // +40 on both axes; the mean of the two is +40.
    act(() => grip.dispatchEvent(pointer("pointermove", 140, 140)));

    expect(onAction).toHaveBeenLastCalledWith({
      type: "row/setTileSize",
      rowId: row.id,
      tileSize: d.display.tileSize + 40,
    });

    // A second move is measured from the press, not compounded onto the first.
    act(() => grip.dispatchEvent(pointer("pointermove", 160, 160)));
    expect(onAction).toHaveBeenLastCalledWith({
      type: "row/setTileSize",
      rowId: row.id,
      tileSize: d.display.tileSize + 60,
    });
  });

  it("grip drags do not start a reorder", () => {
    const d = doc();
    const onAction = vi.fn();
    mount(d, onAction);
    act(() => fireEvent.mouseEnter(handleFor(ordered(d)[GRIP_TIER]!.id)));
    const grip = screen.getByTestId("tier-resize-grip");

    act(() => grip.dispatchEvent(pointer("pointerdown", 100, 100)));
    act(() => grip.dispatchEvent(pointer("pointermove", 140, 400)));
    act(() => grip.dispatchEvent(pointer("pointerup", 140, 400)));

    for (const call of onAction.mock.calls) {
      expect(call[0].type).not.toBe("row/reorder");
    }
  });

  /**
   * The grip sits inside the drag handle, so its press must not reach it. On a
   * touch device a press that arms the handle and then releases is reported as
   * a *tap*, which opens the panel — so a grip drag would end with the panel
   * flying open over the tier the user was resizing. Only a touch mount can
   * catch this: with a precise pointer a tap opens nothing.
   */
  it("a grip drag on a touch device does not open the panel", () => {
    const d = doc();
    mount(d, vi.fn(), false);
    act(() => fireEvent.mouseEnter(handleFor(ordered(d)[GRIP_TIER]!.id)));
    const grip = screen.getByTestId("tier-resize-grip");

    act(() => grip.dispatchEvent(pointer("pointerdown", 100, 100)));
    act(() => grip.dispatchEvent(pointer("pointermove", 130, 130)));
    act(() => grip.dispatchEvent(pointer("pointerup", 130, 130)));

    expect(screen.queryByTestId("tier-panel")).toBeNull();
  });

  /**
   * Ticking the box equalises immediately, at the size the panel is showing. A
   * checkbox that changed nothing until some other control moved would read as
   * broken.
   */
  it("resize all equalises on being ticked, and redirects the slider", () => {
    const d = doc();
    const onAction = vi.fn();
    openPanelOn(d, 1, onAction);

    act(() => fireEvent.click(screen.getByTestId("tier-panel-resize-all")));
    expect(onAction).toHaveBeenLastCalledWith({
      type: "display/setUniformTileSize",
      tileSize: 200,
    });

    act(() => {
      fireEvent.change(screen.getByTestId("tier-panel-size"), { target: { value: "120" } });
    });
    expect(onAction).toHaveBeenLastCalledWith({
      type: "display/setUniformTileSize",
      tileSize: 120,
    });
  });

  it("the grip obeys resize all too, since the mode outlives the panel", () => {
    const d = doc();
    const onAction = vi.fn();
    const row = openPanelOn(d, GRIP_TIER, onAction);

    act(() => fireEvent.click(screen.getByTestId("tier-panel-resize-all")));
    act(() => fireEvent.click(screen.getByTestId("tier-panel-close")));
    expect(screen.queryByTestId("tier-panel")).toBeNull();

    act(() => fireEvent.mouseEnter(handleFor(row.id)));
    const grip = screen.getByTestId("tier-resize-grip");
    act(() => grip.dispatchEvent(pointer("pointerdown", 100, 100)));
    act(() => grip.dispatchEvent(pointer("pointermove", 120, 120)));

    expect(onAction).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: "display/setUniformTileSize" }),
    );
  });
});
