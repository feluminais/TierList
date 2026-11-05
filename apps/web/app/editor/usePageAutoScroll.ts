"use client";

import { useCallback, useEffect, useState, type RefObject } from "react";

export interface PageAutoScroll {
  /** Height of the visible window, for the board's edge bands. */
  viewportHeight: number;
  /**
   * How far the board's top edge is above the window's top, in px: 0 when the
   * board's top is at the window's top, positive once the page has scrolled
   * past it, negative while the board starts lower down. This is the offset
   * that turns a pointer position in board coordinates into one in window
   * coordinates, which is what the edge bands are measured in.
   */
  scrollY: number;
  /** Scrolls the page by `delta` px. Stable. */
  onAutoScroll: (delta: number) => void;
}

/**
 * Lets a drag near the top or bottom of the window scroll the page.
 *
 * The editor route has no scroll container of its own — the page scrolls — so
 * the board's measurements for edge autoscroll come from the window: its
 * height, and where the board sits in it. The offset is read from the board's
 * own bounding box, which is what the scroller actually reports, never
 * computed from the deltas that were requested; the browser clamps a scroll at
 * the page's bounds and a request is only a request.
 *
 * The offset only matters during a drag, so it is tracked only then: from the
 * moment a pointer goes down on the board until it comes up, and while
 * `active` (a drag reported by the board). Tracking always would re-render the
 * editor, and redraw the canvas, on every scroll event for nothing. Starting at
 * the press rather than at the drag matters: the gesture compares each offset
 * with the last it saw to correct for the board moving under a still pointer,
 * so the first offset it sees has to be the real one, before the drag begins,
 * not a jump from a stale zero.
 */
export function usePageAutoScroll(
  boardRef: RefObject<HTMLElement | null>,
  active: boolean,
): PageAutoScroll {
  const [viewportHeight, setViewportHeight] = useState(() =>
    typeof window === "undefined" ? 0 : window.innerHeight,
  );
  const [scrollY, setScrollY] = useState(0);
  const [pressed, setPressed] = useState(false);

  useEffect(() => {
    const onResize = () => setViewportHeight(window.innerHeight);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // On the document rather than on the board element: the owner may replace
  // that element (a rebuilt renderer), and a listener bound to the old one
  // would stop hearing presses.
  useEffect(() => {
    const down = (event: Event) => {
      const board = boardRef.current;
      if (board && event.target instanceof Node && board.contains(event.target)) setPressed(true);
    };
    const up = () => setPressed(false);
    document.addEventListener("pointerdown", down, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", up, true);
    return () => {
      document.removeEventListener("pointerdown", down, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", up, true);
    };
  }, [boardRef]);

  const tracking = active || pressed;
  useEffect(() => {
    if (!tracking) return;
    const read = () => {
      const board = boardRef.current;
      // `|| 0` rather than `-top` outright: `-0` would read as a change.
      if (board) setScrollY(-board.getBoundingClientRect().top || 0);
    };
    read();
    window.addEventListener("scroll", read, { passive: true });
    return () => window.removeEventListener("scroll", read);
  }, [tracking, boardRef]);

  const onAutoScroll = useCallback((delta: number) => {
    window.scrollBy(0, delta);
  }, []);

  return { viewportHeight, scrollY, onAutoScroll };
}
