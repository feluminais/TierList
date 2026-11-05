import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import { createElement, useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContextBanner } from "../app/editor/ContextBanner";
import { useContextRecovery } from "../app/editor/useContextRecovery";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

/** A root holding a canvas, as the editor's shell holds the board's. */
function mountRoot(stallMs?: number) {
  const root = document.createElement("div");
  const canvas = document.createElement("canvas");
  root.appendChild(canvas);
  document.body.appendChild(root);
  const hook = renderHook(() => {
    const ref = useRef<HTMLElement | null>(root);
    return useContextRecovery(ref, { stallMs });
  });
  const lose = () => {
    const event = new Event("webglcontextlost", { cancelable: true, bubbles: false });
    act(() => {
      canvas.dispatchEvent(event);
    });
    return event;
  };
  const restore = () =>
    act(() => {
      canvas.dispatchEvent(new Event("webglcontextrestored"));
    });
  return { hook, lose, restore, root };
}

describe("useContextRecovery", () => {
  it("starts with nothing lost", () => {
    const { hook } = mountRoot();
    expect(hook.result.current).toMatchObject({ epoch: 0, lost: false, stalled: false });
  });

  it("claims the loss, so the browser is allowed to restore the context", () => {
    const { hook, lose } = mountRoot();
    const event = lose();
    expect(event.defaultPrevented).toBe(true);
    expect(hook.result.current.lost).toBe(true);
  });

  it("hears a canvas deep inside the root even though the event does not bubble", () => {
    const { hook, lose } = mountRoot();
    lose();
    expect(hook.result.current.lost).toBe(true);
  });

  it("remounts the renderer when the context is restored, and only then", () => {
    const { hook, lose, restore } = mountRoot();
    lose();
    expect(hook.result.current.epoch).toBe(0);

    restore();
    expect(hook.result.current).toMatchObject({ epoch: 1, lost: false, stalled: false });
  });

  it("calls a loss that is not restored in time stalled", () => {
    const { hook, lose } = mountRoot(3000);
    lose();
    act(() => vi.advanceTimersByTime(2999));
    expect(hook.result.current.stalled).toBe(false);
    act(() => vi.advanceTimersByTime(1));
    expect(hook.result.current.stalled).toBe(true);
  });

  it("does not stall once restored", () => {
    const { hook, lose, restore } = mountRoot(3000);
    lose();
    restore();
    act(() => vi.advanceTimersByTime(10_000));
    expect(hook.result.current.stalled).toBe(false);
  });

  it("recreates on demand, which clears a stalled loss", () => {
    const { hook, lose } = mountRoot(1000);
    lose();
    act(() => vi.advanceTimersByTime(1000));
    expect(hook.result.current.stalled).toBe(true);

    act(() => hook.result.current.recreate());
    expect(hook.result.current).toMatchObject({ epoch: 1, lost: false, stalled: false });
  });

  it("stops listening when unmounted", () => {
    const { hook, lose } = mountRoot();
    hook.unmount();
    const event = lose();
    expect(event.defaultPrevented).toBe(false);
  });
});

describe("ContextBanner", () => {
  const show = (props: { lost: boolean; stalled: boolean }) =>
    render(createElement(ContextBanner, { ...props, onRecreate: vi.fn() }));

  it("is absent when nothing is wrong", () => {
    show({ lost: false, stalled: false });
    expect(screen.queryByTestId("context-banner")).toBeNull();
  });

  it("says it is recovering during a loss, without asking for anything", () => {
    show({ lost: true, stalled: false });
    expect(screen.getByTestId("context-banner").textContent).toContain("Recovering");
    expect(screen.queryByTestId("context-recreate")).toBeNull();
  });

  it("offers to redraw once recovery has stalled", () => {
    const onRecreate = vi.fn();
    render(createElement(ContextBanner, { lost: true, stalled: true, onRecreate }));
    screen.getByTestId("context-recreate").click();
    expect(onRecreate).toHaveBeenCalledTimes(1);
  });
});
