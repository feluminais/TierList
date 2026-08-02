import type { Item, TierListAction } from "@tl/core";
import { defaultImageEdit } from "@tl/core";
import { act, createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditSheet, type EditCanvasComponent, type LiveStrokeProps } from "../app/editor/EditSheet";

/** Square, matching `aspectRatioFor("square")` — the sheet's default shape. */
const SQUARE = 1;
/** height ÷ width for a portrait tile, matching `aspectRatioFor("portrait")`. */
const PORTRAIT = 4 / 3;

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

/**
 * An image tile. The crop is deliberately not full-frame and deliberately not
 * square: a square crop cannot fail for a transposed x and y, which this
 * project has now paid for three times.
 */
function imageItem(): Item {
  return {
    id: "item-1",
    kind: "image",
    label: "Ramen",
    assetId: "asset-1",
    edit: { ...defaultImageEdit(), crop: { x: 0.1, y: 0.2, w: 0.5, h: 0.25 } },
    order: 0,
  };
}

interface Recorded {
  liveStroke: LiveStrokeProps | null;
  item: Item;
  width: number;
  height: number;
}

/** Records every set of props the sheet ever passes down, in render order. */
function stubCanvas(): { Canvas: EditCanvasComponent; renders: Recorded[] } {
  const renders: Recorded[] = [];
  const Canvas: EditCanvasComponent = (props) => {
    renders.push({
      liveStroke: props.liveStroke,
      item: props.item,
      width: props.width,
      height: props.height,
    });
    return null;
  };
  return { Canvas, renders };
}

function lastRender(renders: Recorded[]): Recorded {
  const last = renders[renders.length - 1];
  expect(last).toBeDefined();
  return last!;
}

function pointerEvent(type: string, x: number, y: number): Event {
  // See the jsdom note above for why this is a MouseEvent, not a PointerEvent.
  return new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true });
}

function mountSheet(
  Canvas: EditCanvasComponent,
  onAction: (a: TierListAction) => void,
  options: { item?: Item; tileAspect?: number; onClose?: () => void } = {},
) {
  render(
    createElement(EditSheet, {
      item: options.item ?? textItem(),
      EditCanvas: Canvas,
      tileAspect: options.tileAspect ?? SQUARE,
      assetUrl: () => "",
      onAction,
      onClose: options.onClose ?? (() => {}),
    }),
  );
  return screen.getByTestId("edit-sheet-canvas");
}

/** Mounts an image tile and switches to the pen, which it does not open on. */
function mountImageSheetInDrawMode(
  Canvas: EditCanvasComponent,
  onAction: (a: TierListAction) => void,
) {
  const el = mountSheet(Canvas, onAction, { item: imageItem() });
  act(() => {
    fireEvent.click(screen.getByTestId("sheet-mode-draw"));
  });
  return el;
}

function setEdit(action: unknown) {
  const typed = action as TierListAction & { type: "item/setEdit" };
  expect(typed.type).toBe("item/setEdit");
  return typed;
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
    const { Canvas, renders } = stubCanvas();
    const onAction = vi.fn();
    const el = mountSheet(Canvas, onAction);

    act(() => el.dispatchEvent(pointerEvent("pointerdown", 50, 50)));
    act(() => el.dispatchEvent(pointerEvent("pointermove", 80, 90)));
    act(() => el.dispatchEvent(pointerEvent("pointermove", 110, 50)));

    // Not yet committed: the document is untouched until penUp.
    expect(onAction).not.toHaveBeenCalled();

    const last = lastRender(renders).liveStroke;
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

describe("EditSheet — modes", () => {
  it("opens a text tile on the pen and offers no crop tab", () => {
    const { Canvas } = stubCanvas();
    mountSheet(Canvas, vi.fn());
    expect(screen.queryByTestId("sheet-mode-crop")).toBeNull();
    expect(screen.queryByTestId("crop-zoom")).toBeNull();
  });

  it("opens an image tile on crop, which is what the milestone was missing", () => {
    const { Canvas } = stubCanvas();
    mountSheet(Canvas, vi.fn(), { item: imageItem() });
    expect(screen.getByTestId("sheet-mode-crop").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("crop-zoom")).not.toBeNull();
  });

  /**
   * The join that the pure tests cannot see. A drag on the surface has to
   * reach `cropReduce` rather than `editReduce` — every layer being correct in
   * isolation while the wire between them goes to the wrong place is the exact
   * shape of every defect this milestone has shipped.
   */
  it("a drag in crop mode moves the crop and draws no stroke", () => {
    const { Canvas } = stubCanvas();
    const onAction = vi.fn();
    const el = mountSheet(Canvas, onAction, { item: imageItem() });

    act(() => el.dispatchEvent(pointerEvent("pointerdown", 300, 300)));
    act(() => el.dispatchEvent(pointerEvent("pointermove", 240, 260)));
    act(() => el.dispatchEvent(pointerEvent("pointerup", 200, 240)));

    expect(onAction).toHaveBeenCalledTimes(1);
    const action = setEdit(onAction.mock.calls[0]![0]);
    expect(action.edit.strokes).toHaveLength(0);
    // Dragging left moves the window right, and neither axis is untouched.
    expect(action.edit.crop.x).toBeGreaterThan(imageItem().edit.crop.x);
    expect(action.edit.crop.y).toBeGreaterThan(imageItem().edit.crop.y);
    // Panning never changes the crop's size.
    expect(action.edit.crop.w).toBe(imageItem().edit.crop.w);
    expect(action.edit.crop.h).toBe(imageItem().edit.crop.h);
  });

  it("shows the gesture's own crop before it commits, and emits nothing until it does", () => {
    const { Canvas, renders } = stubCanvas();
    const onAction = vi.fn();
    const el = mountSheet(Canvas, onAction, { item: imageItem() });

    act(() => el.dispatchEvent(pointerEvent("pointerdown", 300, 300)));
    act(() => el.dispatchEvent(pointerEvent("pointermove", 240, 260)));

    expect(onAction).not.toHaveBeenCalled();
    // The canvas is already drawing the moved crop — the document is not.
    expect(lastRender(renders).item.edit.crop.x).toBeGreaterThan(imageItem().edit.crop.x);
  });

  it("switching to Draw makes the same drag a stroke", () => {
    const { Canvas } = stubCanvas();
    const onAction = vi.fn();
    const el = mountImageSheetInDrawMode(Canvas, onAction);

    act(() => el.dispatchEvent(pointerEvent("pointerdown", 300, 300)));
    act(() => el.dispatchEvent(pointerEvent("pointermove", 240, 260)));
    act(() => el.dispatchEvent(pointerEvent("pointerup", 200, 240)));

    expect(onAction).toHaveBeenCalledTimes(1);
    const action = setEdit(onAction.mock.calls[0]![0]);
    expect(action.edit.strokes).toHaveLength(1);
    expect(action.edit.crop).toEqual(imageItem().edit.crop);
  });

  it("emits nothing for a click in crop mode that moved nothing", () => {
    const { Canvas } = stubCanvas();
    const onAction = vi.fn();
    const el = mountSheet(Canvas, onAction, { item: imageItem() });

    act(() => el.dispatchEvent(pointerEvent("pointerdown", 300, 300)));
    act(() => el.dispatchEvent(pointerEvent("pointerup", 300, 300)));

    expect(onAction).not.toHaveBeenCalled();
  });

  /**
   * The zoom slider has no release event this component sees — React's
   * `onChange` on a range *is* `input` — so a run is closed by an idle timer.
   * Pressing Done inside that window has to flush it, or the reframe is lost
   * on the way out: the sheet unmounts, the timer is cleared, and the action
   * carrying the crop is never emitted.
   */
  it("commits a zoom still behind the idle timer when Done is pressed", () => {
    const { Canvas } = stubCanvas();
    const onAction = vi.fn();
    mountSheet(Canvas, onAction, { item: imageItem() });

    act(() => {
      fireEvent.change(screen.getByTestId("crop-zoom"), { target: { value: "0.5" } });
    });
    expect(onAction).not.toHaveBeenCalled();

    act(() => {
      fireEvent.click(screen.getByTestId("edit-sheet-done"));
    });

    expect(onAction).toHaveBeenCalledTimes(1);
    const action = setEdit(onAction.mock.calls[0]![0]);
    // Zoomed in: the crop got smaller on both axes, by one shared factor.
    const before = imageItem().edit.crop;
    expect(action.edit.crop.w).toBeLessThan(before.w);
    expect(action.edit.crop.h).toBeLessThan(before.h);
    expect(action.edit.crop.w / before.w).toBeCloseTo(action.edit.crop.h / before.h, 10);
  });

  it("closes the sheet when Done is pressed", () => {
    const { Canvas } = stubCanvas();
    const onClose = vi.fn();
    mountSheet(Canvas, vi.fn(), { item: imageItem(), onClose });

    act(() => {
      fireEvent.click(screen.getByTestId("edit-sheet-done"));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  /**
   * A square sheet showing a portrait tile frames a crop the board then crops
   * further, and the user only finds out after pressing Done. Asymmetric by
   * construction — a square assertion here could not fail.
   */
  it("sizes the canvas to the tile's aspect, not to a square", () => {
    const { Canvas, renders } = stubCanvas();
    mountSheet(Canvas, vi.fn(), { item: imageItem(), tileAspect: PORTRAIT });

    const { width, height } = lastRender(renders);
    expect(height).toBeGreaterThan(width);
    expect(height / width).toBeCloseTo(PORTRAIT, 2);
  });

  it("is square when the tile is", () => {
    const { Canvas, renders } = stubCanvas();
    mountSheet(Canvas, vi.fn(), { item: imageItem(), tileAspect: SQUARE });
    const { width, height } = lastRender(renders);
    expect(width).toBe(height);
  });
});
