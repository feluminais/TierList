import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePageAutoScroll } from "../app/editor/usePageAutoScroll";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let top: number;
let scrollBy: ReturnType<typeof vi.fn>;

/** A board element whose distance from the top of the viewport the test controls. */
function board(): HTMLElement {
  const el = document.createElement("div");
  el.getBoundingClientRect = () => ({ top, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: top, toJSON: () => ({}) });
  return el;
}

beforeEach(() => {
  top = 120;
  scrollBy = vi.fn();
  window.scrollBy = scrollBy as unknown as typeof window.scrollBy;
  Object.defineProperty(window, "innerHeight", { value: 700, configurable: true, writable: true });
});
afterEach(() => vi.restoreAllMocks());

function mount(active: boolean) {
  const el = board();
  return renderHook(({ active }) => usePageAutoScroll({ current: el }, active), {
    initialProps: { active },
  });
}

const scrollTo = (newTop: number) =>
  act(() => {
    top = newTop;
    window.dispatchEvent(new Event("scroll"));
  });

describe("usePageAutoScroll", () => {
  it("reports the window as the viewport", () => {
    const { result } = mount(false);
    expect(result.current.viewportHeight).toBe(700);
  });

  it("scrolls the page by the requested amount", () => {
    const { result } = mount(false);
    result.current.onAutoScroll(24);
    expect(scrollBy).toHaveBeenCalledWith(0, 24);
  });

  it("reads how far above the viewport the board's top is, once a drag starts", () => {
    const { result, rerender } = mount(false);
    expect(result.current.scrollY).toBe(0);

    top = -300; // the page has been scrolled 300px past the board's top
    rerender({ active: true });
    expect(result.current.scrollY).toBe(300);
  });

  it("follows the page while a drag is under way, from the scroller's own reading", () => {
    const { result } = mount(true);
    scrollTo(-340);
    expect(result.current.scrollY).toBe(340);
    scrollTo(-100);
    expect(result.current.scrollY).toBe(100);
  });

  it("is negative while the board's top is below the viewport's top", () => {
    const { result } = mount(true);
    scrollTo(60);
    expect(result.current.scrollY).toBe(-60);
  });

  it("stops listening when the drag ends", () => {
    const { result, rerender } = mount(true);
    scrollTo(-50);
    expect(result.current.scrollY).toBe(50);

    rerender({ active: false });
    scrollTo(-400);
    expect(result.current.scrollY).toBe(50);
  });

  it("follows a resized window", () => {
    const { result } = mount(false);
    act(() => {
      (window as { innerHeight: number }).innerHeight = 500;
      window.dispatchEvent(new Event("resize"));
    });
    expect(result.current.viewportHeight).toBe(500);
  });

  it("starts reading the offset when a pointer goes down on the board, before any drag", () => {
    const el = board();
    document.body.appendChild(el);
    const { result } = renderHook(() => usePageAutoScroll({ current: el }, false));
    expect(result.current.scrollY).toBe(0);

    top = -250;
    act(() => {
      el.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    expect(result.current.scrollY).toBe(250);

    scrollTo(-275);
    expect(result.current.scrollY).toBe(275);
  });

  it("ignores a press outside the board", () => {
    const el = board();
    const outside = document.createElement("div");
    document.body.append(el, outside);
    const { result } = renderHook(() => usePageAutoScroll({ current: el }, false));

    top = -250;
    act(() => {
      outside.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    expect(result.current.scrollY).toBe(0);
  });

  it("stops reading once the pointer is up", () => {
    const el = board();
    document.body.appendChild(el);
    const { result } = renderHook(() => usePageAutoScroll({ current: el }, false));
    act(() => {
      el.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    scrollTo(-100);
    expect(result.current.scrollY).toBe(100);

    act(() => {
      window.dispatchEvent(new Event("pointerup"));
    });
    scrollTo(-900);
    expect(result.current.scrollY).toBe(100);
  });

  it("keeps onAutoScroll stable, because the gesture hook reads it through a ref", () => {
    const { result, rerender } = mount(false);
    const first = result.current.onAutoScroll;
    rerender({ active: true });
    expect(result.current.onAutoScroll).toBe(first);
  });
});
