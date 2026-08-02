import type { Item, TierListAction } from "@tl/core";
import { defaultImageEdit } from "@tl/core";
import { act, createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditSheet, type EditCanvasComponent, type LiveStrokeProps } from "../app/editor/EditSheet";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * jsdom implements neither `PointerEvent` nor pointer-capture methods
 * (https://github.com/jsdom/jsdom/issues/2527), and `EditSheet` calls
 * `setPointerCapture`/`hasPointerCapture`/`releasePointerCapture` on every
 * gesture. A plain `MouseEvent` carries the `clientX`/`clientY` the sheet
 * actually reads, so it stands in for a pointer event here; only the capture
 * methods need a no-op shim for the handlers to run at all.
 */
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

function textItem(): Item {
  return { id: "item-1", kind: "text", label: "Ramen", edit: defaultImageEdit(), order: 0 };
}

/** Records every `liveStroke` the sheet ever passes down, in render order. */
function stubCanvas(): { Canvas: EditCanvasComponent; liveStrokes: (LiveStrokeProps | null)[] } {
  const liveStrokes: (LiveStrokeProps | null)[] = [];
  const Canvas: EditCanvasComponent = (props) => {
    liveStrokes.push(props.liveStroke);
    return null;
  };
  return { Canvas, liveStrokes };
}

function pointerEvent(type: string, x: number, y: number): Event {
  // See the jsdom note above for why this is a MouseEvent, not a PointerEvent.
  return new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true });
}

function mountSheet(Canvas: EditCanvasComponent, onAction: (a: TierListAction) => void) {
  render(
    createElement(EditSheet, {
      item: textItem(),
      EditCanvas: Canvas,
      assetUrl: () => "",
      onAction,
      onClose: () => {},
    }),
  );
  return screen.getByTestId("edit-sheet-canvas");
}

describe("EditSheet", () => {
  it("commits exactly one item/setEdit carrying one stroke for a drag on a text tile", () => {
    const { Canvas } = stubCanvas();
    const onAction = vi.fn();
    const el = mountSheet(Canvas, onAction);

    act(() => el.dispatchEvent(pointerEvent("pointerdown", 50, 50)));
    act(() => el.dispatchEvent(pointerEvent("pointermove", 80, 90)));
    act(() => el.dispatchEvent(pointerEvent("pointermove", 110, 50)));
    act(() => el.dispatchEvent(pointerEvent("pointerup", 140, 90)));

    expect(onAction).toHaveBeenCalledTimes(1);
    const action = onAction.mock.calls[0]![0] as TierListAction & { type: "item/setEdit" };
    expect(action.type).toBe("item/setEdit");
    expect(action.edit.strokes).toHaveLength(1);
  });

  it("passes a live stroke with at least two points to the canvas while drawing, before pointerup", () => {
    const { Canvas, liveStrokes } = stubCanvas();
    const onAction = vi.fn();
    const el = mountSheet(Canvas, onAction);

    act(() => el.dispatchEvent(pointerEvent("pointerdown", 50, 50)));
    act(() => el.dispatchEvent(pointerEvent("pointermove", 80, 90)));
    act(() => el.dispatchEvent(pointerEvent("pointermove", 110, 50)));

    // Not yet committed: the document is untouched until penUp.
    expect(onAction).not.toHaveBeenCalled();

    const last = liveStrokes[liveStrokes.length - 1];
    expect(last).not.toBeNull();
    expect(last!.points.length / 2).toBeGreaterThanOrEqual(2);

    act(() => el.dispatchEvent(pointerEvent("pointerup", 110, 50)));
  });

  /**
   * The regression test for the stale-ref defect: `pointermove` fires faster
   * than React re-renders, so several moves can land in one batch. Before the
   * fix, `editRef.current` was only reassigned at render time, so every move
   * in a batch read the same stale state and all but the last was silently
   * discarded from the committed stroke.
   *
   * The points below zigzag hard enough (200px swings against a 0.002,
   * source-normalized tolerance) that `simplifyPoints` keeps every one of
   * them, so the final stroke's point count is a direct, exact readout of how
   * many samples survived — not an approximation.
   */
  it("drops no points when several moves land in one render batch", () => {
    const { Canvas } = stubCanvas();
    const onAction = vi.fn();
    const el = mountSheet(Canvas, onAction);

    act(() => el.dispatchEvent(pointerEvent("pointerdown", 50, 100)));

    const moves: Array<[number, number]> = [
      [100, 300],
      [150, 100],
      [200, 300],
      [250, 100],
      [300, 300],
    ];
    // All five moves dispatched inside one `act` callback, with nothing
    // awaited in between — exactly the "faster than React can render"
    // scenario the defect described. A real browser can deliver this many
    // `pointermove` events within a single task just as easily.
    act(() => {
      for (const [x, y] of moves) {
        el.dispatchEvent(pointerEvent("pointermove", x, y));
      }
    });

    act(() => el.dispatchEvent(pointerEvent("pointerup", 350, 100)));

    expect(onAction).toHaveBeenCalledTimes(1);
    const action = onAction.mock.calls[0]![0] as TierListAction & { type: "item/setEdit" };
    const stroke = action.edit.strokes[0]!;
    // 1 (penDown) + 5 (moves) + 1 (penUp) — every sample survives simplification.
    expect(stroke.points.length / 2).toBe(7);
  });

  it("emits no action for a tap with no movement", () => {
    const { Canvas } = stubCanvas();
    const onAction = vi.fn();
    const el = mountSheet(Canvas, onAction);

    act(() => el.dispatchEvent(pointerEvent("pointerdown", 50, 50)));
    act(() => el.dispatchEvent(pointerEvent("pointerup", 50, 50)));

    expect(onAction).not.toHaveBeenCalled();
  });
});
