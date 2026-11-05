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
 * The offset only matters while something is being dragged, so it is tracked
 * only while `active`. Doing it always would re-render the editor on every
 * scroll event for nothing.
 */
export function usePageAutoScroll(
  boardRef: RefObject<HTMLElement | null>,
  active: boolean,
): PageAutoScroll {
  const [viewportHeight, setViewportHeight] = useState(() =>
    typeof window === "undefined" ? 0 : window.innerHeight,
  );
  const [scrollY, setScrollY] = useState(0);

  useEffect(() => {
    const onResize = () => setViewportHeight(window.innerHeight);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (!active) return;
    const read = () => {
      const board = boardRef.current;
      // `|| 0` rather than `-top` outright: `-0` would read as a change.
      if (board) setScrollY(-board.getBoundingClientRect().top || 0);
    };
    read();
    window.addEventListener("scroll", read, { passive: true });
    return () => window.removeEventListener("scroll", read);
  }, [active, boardRef]);

  const onAutoScroll = useCallback((delta: number) => {
    window.scrollBy(0, delta);
  }, []);

  return { viewportHeight, scrollY, onAutoScroll };
}
