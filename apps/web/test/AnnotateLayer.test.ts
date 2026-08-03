import { DEFAULT_STROKE_WIDTH, createTierList, reduce, type TierList, type TierListAction } from "@tl/core";
import { layoutBoard } from "@tl/editor-core";
import { act, createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnnotateLayer, type LiveAnnotation } from "../app/editor/AnnotateLayer";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = "2026-08-01T12:00:00.000Z";
const WIDTH = 800;

/** jsdom lays nothing out; the board's origin is 0,0, so zero is faithful. */
Element.prototype.getBoundingClientRect = () => ({
  left: 0, top: 0, right: WIDTH, bottom: 0, width: WIDTH, height: 0, x: 0, y: 0,
  toJSON() {},
});

type CaptureCapable = Element & { setPointerCapture?: (id: number) => void };
const proto = Element.prototype as CaptureCapable;
if (!proto.setPointerCapture) proto.setPointerCapture = () => {};

afterEach(cleanup);

function doc(): TierList {
  return createTierList({ id: "list-1", now: NOW });
}

function withMarks(base: TierList, ids: string[]): TierList {
  return ids.reduce(
    (d, id) =>
      reduce(
        d,
        {
          type: "board/addStroke",
          stroke: { id, points: [0.1, 0.2, 0.4, 0.5], color: "#fff", width: DEFAULT_STROKE_WIDTH },
        },
        NOW,
      ),
    base,
  );
}

/** Records every live annotation the layer hands its child, in render order. */
function mount(d: TierList, onAction: (a: TierListAction) => void, onDone = vi.fn()) {
  const lives: (LiveAnnotation | null)[] = [];
  render(
    createElement(AnnotateLayer, {
      doc: d,
      layout: layoutBoard(d, { width: WIDTH }),
      width: WIDTH,
      onAction,
      onDone,
      children: (live: LiveAnnotation | null) => {
        lives.push(live);
        return null;
      },
    }),
  );
  return { lives, onDone };
}

function pointer(type: string, x: number, y: number): Event {
  return new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true });
}

function surface() {
  return screen.getByTestId("annotate-surface");
}

describe("AnnotateLayer", () => {
  it("commits exactly one board/addStroke for a drag, at the end", () => {
    const onAction = vi.fn();
    mount(doc(), onAction);
    const el = surface();

    act(() => el.dispatchEvent(pointer("pointerdown", 40, 60)));
    act(() => el.dispatchEvent(pointer("pointermove", 200, 160)));
    expect(onAction).not.toHaveBeenCalled();

    act(() => el.dispatchEvent(pointer("pointermove", 400, 60)));
    act(() => el.dispatchEvent(pointer("pointerup", 600, 200)));

    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction.mock.calls[0]![0]!.type).toBe("board/addStroke");
  });

  it("shows the mark under the pen before it is committed", () => {
    const { lives } = mount(doc(), vi.fn());
    const el = surface();

    act(() => el.dispatchEvent(pointer("pointerdown", 40, 60)));
    act(() => el.dispatchEvent(pointer("pointermove", 200, 160)));

    const live = lives[lives.length - 1];
    expect(live).not.toBeNull();
    // Board coordinates, not the 0..1 the document stores.
    expect(live!.points[0]).toBeCloseTo(40, 6);
    expect(live!.points[1]).toBeCloseTo(60, 6);
    expect(live!.width).toBeGreaterThan(1);
  });

  it("clears the live mark once the gesture ends", () => {
    const { lives } = mount(doc(), vi.fn());
    const el = surface();

    act(() => el.dispatchEvent(pointer("pointerdown", 40, 60)));
    act(() => el.dispatchEvent(pointer("pointermove", 200, 160)));
    act(() => el.dispatchEvent(pointer("pointerup", 300, 200)));

    expect(lives[lives.length - 1]).toBeNull();
  });

  it("emits nothing for a tap", () => {
    const onAction = vi.fn();
    mount(doc(), onAction);
    const el = surface();

    act(() => el.dispatchEvent(pointer("pointerdown", 40, 60)));
    act(() => el.dispatchEvent(pointer("pointerup", 40, 60)));

    expect(onAction).not.toHaveBeenCalled();
  });

  it("draws in the chosen colour and weight", () => {
    const onAction = vi.fn();
    mount(doc(), onAction);

    act(() => fireEvent.click(screen.getByTestId("annotate-width-bold")));

    const el = surface();
    act(() => el.dispatchEvent(pointer("pointerdown", 40, 60)));
    act(() => el.dispatchEvent(pointer("pointerup", 400, 200)));

    const stroke = (onAction.mock.calls[0]![0] as TierListAction & { type: "board/addStroke" })
      .stroke;
    expect(stroke.width).toBe(DEFAULT_STROKE_WIDTH * 2);
    expect(stroke.color).toBe("#4ade80");
  });

  /**
   * A width is a fraction of the board, not a pixel count — that is what keeps
   * a mark's weight right when the board is laid out at another size.
   */
  it("stores the width as a fraction, and the points normalized", () => {
    const onAction = vi.fn();
    mount(doc(), onAction);
    const el = surface();

    act(() => el.dispatchEvent(pointer("pointerdown", 0, 0)));
    act(() => el.dispatchEvent(pointer("pointerup", WIDTH, 0)));

    const stroke = (onAction.mock.calls[0]![0] as TierListAction & { type: "board/addStroke" })
      .stroke;
    expect(stroke.width).toBeLessThan(1);
    expect(stroke.points[0]).toBeCloseTo(0, 6);
    expect(stroke.points[2]).toBeCloseTo(1, 6);
  });

  it("removes the most recent mark, not the first", () => {
    const onAction = vi.fn();
    mount(withMarks(doc(), ["a", "b", "c"]), onAction);

    act(() => fireEvent.click(screen.getByTestId("annotate-undo-last")));
    expect(onAction).toHaveBeenCalledWith({ type: "board/removeStroke", strokeId: "c" });
  });

  it("clears every mark in one action", () => {
    const onAction = vi.fn();
    mount(withMarks(doc(), ["a", "b"]), onAction);

    act(() => fireEvent.click(screen.getByTestId("annotate-clear")));
    expect(onAction).toHaveBeenCalledWith({ type: "board/clearStrokes" });
  });

  it("disables both removals when there is nothing to remove", () => {
    mount(doc(), vi.fn());
    expect(screen.getByTestId<HTMLButtonElement>("annotate-undo-last").disabled).toBe(true);
    expect(screen.getByTestId<HTMLButtonElement>("annotate-clear").disabled).toBe(true);
  });

  it("counts the marks on the list", () => {
    mount(withMarks(doc(), ["a", "b"]), vi.fn());
    expect(screen.getByTestId("annotate-count").textContent).toBe("2 marks");
    cleanup();
    mount(withMarks(doc(), ["a"]), vi.fn());
    expect(screen.getByTestId("annotate-count").textContent).toBe("1 mark");
  });

  it("puts the pen away on Done", () => {
    const { onDone } = mount(doc(), vi.fn());
    act(() => fireEvent.click(screen.getByTestId("annotate-done")));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("commits nothing when the gesture is cancelled", () => {
    const onAction = vi.fn();
    mount(doc(), onAction);
    const el = surface();

    act(() => el.dispatchEvent(pointer("pointerdown", 40, 60)));
    act(() => el.dispatchEvent(pointer("pointermove", 300, 200)));
    act(() => el.dispatchEvent(pointer("pointercancel", 300, 200)));

    expect(onAction).not.toHaveBeenCalled();
  });

  /**
   * The regression the tile pen already paid for: pointer moves outrun React's
   * render and batch, so a handler reading the state variable rather than the
   * ref would reduce against what last rendered and drop every point but one.
   */
  it("drops no points when several moves land in one render batch", () => {
    const onAction = vi.fn();
    mount(doc(), onAction);
    const el = surface();

    act(() => el.dispatchEvent(pointer("pointerdown", 0, 0)));
    act(() => {
      for (const [x, y] of [[100, 300], [200, 0], [300, 300], [400, 0], [500, 300]]) {
        el.dispatchEvent(pointer("pointermove", x!, y!));
      }
    });
    act(() => el.dispatchEvent(pointer("pointerup", 600, 0)));

    const stroke = (onAction.mock.calls[0]![0] as TierListAction & { type: "board/addStroke" })
      .stroke;
    // 1 down + 5 moves + 1 up, zigzagging hard enough that none is thinned.
    expect(stroke.points.length / 2).toBe(7);
  });
});
