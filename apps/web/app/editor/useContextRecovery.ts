"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

/** How long a lost context may take to come back before the person is offered a redraw. */
export const CONTEXT_STALL_MS = 4000;

export interface ContextRecovery {
  /** Changes each time the renderer should be rebuilt; use it as a React `key`. */
  epoch: number;
  /** A WebGL context under the root has been lost and not yet restored. */
  lost: boolean;
  /** The loss has lasted past `stallMs`; the browser may not restore it by itself. */
  stalled: boolean;
  /** Rebuilds the renderer now, for a context that is not coming back. */
  recreate: () => void;
}

/**
 * Keeps the board alive when the browser takes its WebGL context away.
 *
 * A context is lost when the GPU resets, the driver crashes, a tab is
 * backgrounded under memory pressure or too many contexts are open. The
 * canvas then draws nothing, and Skia's surface cannot be revived in place.
 * The document is untouched by any of this — it lives in the session, not in
 * the canvas — so recovery is to build the renderer again from it.
 *
 * `webglcontextlost` is cancelable, and cancelling it is what tells the
 * browser the page wants the context back; without that a lost context stays
 * lost. The event does not bubble, so the listeners sit on the root in the
 * capture phase, which reaches a canvas anywhere beneath it.
 *
 * On `webglcontextrestored` the epoch moves and the owner re-keys the board,
 * which mounts a fresh canvas and a fresh Skia surface. If no restore arrives
 * within `stallMs`, `stalled` lets the owner offer `recreate`, which does the
 * same on request.
 */
export function useContextRecovery(
  rootRef: RefObject<HTMLElement | null>,
  options: { stallMs?: number } = {},
): ContextRecovery {
  const stallMs = options.stallMs ?? CONTEXT_STALL_MS;
  const [epoch, setEpoch] = useState(0);
  const [lost, setLost] = useState(false);
  const [stalled, setStalled] = useState(false);
  const stallTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const clearStall = useCallback(() => {
    clearTimeout(stallTimer.current);
    stallTimer.current = undefined;
  }, []);

  const recreate = useCallback(() => {
    clearStall();
    setLost(false);
    setStalled(false);
    setEpoch((n) => n + 1);
  }, [clearStall]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const onLost = (event: Event) => {
      event.preventDefault();
      setLost(true);
      clearStall();
      stallTimer.current = setTimeout(() => setStalled(true), stallMs);
    };
    const onRestored = () => recreate();

    root.addEventListener("webglcontextlost", onLost, true);
    root.addEventListener("webglcontextrestored", onRestored, true);
    return () => {
      root.removeEventListener("webglcontextlost", onLost, true);
      root.removeEventListener("webglcontextrestored", onRestored, true);
      clearStall();
    };
  }, [rootRef, stallMs, clearStall, recreate]);

  return { epoch, lost, stalled, recreate };
}
