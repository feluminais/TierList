import type { TierListAction } from "@tl/core";
import {
  autoScrollDelta,
  dragReduce,
  idleDrag,
  pointerAfterScroll,
  DRAG_HOLD_MS,
  type BoardLayout,
  type DragEvent,
  type DragState,
} from "@tl/editor-core";
import { useCallback, useEffect, useRef, useState } from "react";
import type { GestureResponderEvent } from "react-native";

/**
 * When to fire the hold timer.
 *
 * `dragReduce` does the elapsed-time comparison itself and promotes a press to
 * a drag only once `DRAG_HOLD_MS` has genuinely passed. A timer that fired even
 * a millisecond early would therefore be *rejected*, and because a stationary
 * finger produces no further events there would be nothing to retry with: the
 * drag would silently never start. Late always satisfies the comparison; early
 * never does, so the margin only ever goes one way.
 *
 * It is not there for `setTimeout` overshoot — that direction is safe. It is
 * there because the timer is scheduled against the platform's monotonic clock
 * while the events are stamped with `Date.now()`, and a wall clock can be
 * stepped backwards under a running timer.
 */
const HOLD_TIMER_MS = DRAG_HOLD_MS + 10;

export interface BoardGestureOptions {
  layout: BoardLayout;
  /** Applied when a drag commits. One drag produces at most one action. */
  onAction: (action: TierListAction) => void;
  /** A tap that never became a drag. Milestone 2D gives this a meaning. */
  onTap?: (itemId: string) => void;
  /** Height of the visible scroll viewport, for edge autoscroll. */
  viewportHeight?: number;
  /** Current scroll offset, so viewport-relative pointer y can be derived. */
  scrollY?: number;
  /** Called each frame while the pointer sits in an edge band. */
  onAutoScroll?: (delta: number) => void;
  /**
   * Forwarded verbatim into every `down` event's `immediate` flag — see
   * `DragEvent` in `@tl/editor-core` for what it means. This hook does not
   * decide which inputs get it; the device check belongs to a caller that
   * knows it is running on the web, not to this hook or to `dragReduce`,
   * both of which are shared with the Android app. Defaults to false, so a
   * caller that never passes it keeps the existing hold-then-drag behaviour.
   */
  immediateDrag?: boolean;
}

export interface BoardGesture {
  drag: DragState;
  /** Spread onto the View wrapping the canvas. */
  handlers: {
    onStartShouldSetResponder: () => boolean;
    onResponderGrant: (e: GestureResponderEvent) => void;
    onResponderMove: (e: GestureResponderEvent) => void;
    onResponderRelease: (e: GestureResponderEvent) => void;
    onResponderTerminate: () => void;
    onResponderTerminationRequest: () => boolean;
  };
}

/**
 * Adapts the React Native responder system onto `dragReduce`.
 *
 * Three things the pure machine deliberately lacks and this supplies:
 * **events**, a **clock** (`Date.now()` at this boundary only, so the reducer
 * stays deterministic), and a **frame loop** for edge autoscroll.
 *
 * Coordinates come from `locationX`/`locationY`, which are relative to the view
 * the touch is over — so this hook's handlers must go on a view whose origin is
 * the layout's origin. `InteractiveBoard` is what guarantees that.
 */
export function useBoardGesture(options: BoardGestureOptions): BoardGesture {
  const {
    layout,
    onAction,
    onTap,
    viewportHeight,
    scrollY,
    onAutoScroll,
    immediateDrag = false,
  } = options;

  const [drag, setDrag] = useState<DragState>(idleDrag);

  // Mirrors `drag` for the callbacks, which must read the current phase without
  // being re-created -- a stale closure here would send events against the
  // wrong state. Written only by `send`, which sets it *before* calling
  // `setDrag`, so it leads the rendered state rather than lagging it. That is
  // the property the whole gesture depends on: responder callbacks fire from
  // raw platform listeners and do not wait for React to commit anything.
  //
  // Deliberately not assigned during render. A render can be thrown away under
  // concurrent rendering and its ref writes still land, and there is nothing
  // for a render-time write to fix here anyway: `send` is the only writer of
  // `drag`, so the ref can never be behind it.
  const dragRef = useRef<DragState>(idleDrag());

  // `layout` arrives as a prop, so `send` cannot keep it current the way it
  // keeps `dragRef`, and the hold timer fires outside any render and so cannot
  // close over it. Written from an effect rather than during render, for the
  // same reason as above. The cost -- being one commit behind until passive
  // effects flush -- is not reachable in practice: a layout changes only when
  // the document or the width does, the document is frozen for the duration of
  // a gesture by design, and a resize mid-press is not a gesture anyone
  // performs.
  const layoutRef = useRef(layout);
  useEffect(() => {
    layoutRef.current = layout;
  }, [layout]);

  // Read by the frame loop, which must not be torn down and rebuilt every time
  // the scroll offset ticks -- and while autoscroll is running, it ticks every
  // frame. Keeping the loop's lifetime tied to the drag alone means it starts
  // and stops exactly once per gesture.
  const scrollRef = useRef({ viewportHeight, scrollY, onAutoScroll });
  useEffect(() => {
    scrollRef.current = { viewportHeight, scrollY, onAutoScroll };
  }, [viewportHeight, scrollY, onAutoScroll]);

  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPoint = useRef({ x: 0, y: 0 });

  const clearHold = useCallback(() => {
    if (holdTimer.current !== null) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
  }, []);

  const send = useCallback(
    (event: DragEvent) => {
      const out = dragReduce(dragRef.current, event);
      dragRef.current = out.state;
      setDrag(out.state);
      if (out.state.phase !== "pending") clearHold();
      if (out.action) onAction(out.action);
      if (out.tapped && onTap) onTap(out.tapped.itemId);
    },
    [clearHold, onAction, onTap],
  );

  const pointOf = (e: GestureResponderEvent) => ({
    x: e.nativeEvent.locationX,
    y: e.nativeEvent.locationY,
  });

  const handlers = {
    onStartShouldSetResponder: () => true,

    onResponderGrant: (e: GestureResponderEvent) => {
      const point = pointOf(e);
      lastPoint.current = point;
      send({
        type: "down",
        at: { point, time: Date.now() },
        layout: layoutRef.current,
        immediate: immediateDrag,
      });

      // A stationary finger produces no move events, so the promotion to a
      // drag has to be driven by a timer. `dragReduce` ignores a `hold` that
      // arrives in a state that has moved on, so a late timer is harmless --
      // but a press that did not land on a tile leaves the machine idle, and
      // there is nothing for a timer to promote, so none is armed.
      clearHold();
      if (dragRef.current.phase !== "pending") return;

      holdTimer.current = setTimeout(() => {
        send({
          type: "hold",
          at: { point: lastPoint.current, time: Date.now() },
          layout: layoutRef.current,
        });
      }, HOLD_TIMER_MS);
    },

    onResponderMove: (e: GestureResponderEvent) => {
      const point = pointOf(e);
      lastPoint.current = point;
      send({ type: "move", at: { point, time: Date.now() }, layout: layoutRef.current });
    },

    onResponderRelease: (e: GestureResponderEvent) => {
      clearHold();
      send({ type: "up", at: { point: pointOf(e), time: Date.now() }, layout: layoutRef.current });
    },

    onResponderTerminate: () => {
      clearHold();
      send({ type: "cancel" });
    },

    /**
     * The whole touch-first story in one line. While a press is merely
     * pending, a parent ScrollView may take the gesture -- which is exactly
     * right, because the user meant to scroll. Once the drag is under way the
     * gesture is ours, and handing it back would drop the item unasked.
     */
    onResponderTerminationRequest: () => dragRef.current.phase !== "dragging",
  };

  // Edge autoscroll. Its lifetime is the drag's: the viewport and the scroll
  // offset are read through a ref precisely so that a scroll -- which is what
  // this loop causes -- cannot restart the loop that caused it.
  useEffect(() => {
    if (drag.phase !== "dragging") return;

    let frame = 0;
    const tick = () => {
      frame = requestAnimationFrame(tick);

      const state = dragRef.current;
      const { viewportHeight: height, scrollY: offset, onAutoScroll: scroll } =
        scrollRef.current;
      // Measured after the drag began is still measured: the guard is here
      // rather than on the effect so a viewport that arrives late still works.
      if (state.phase !== "dragging" || !scroll || !height) return;

      // `pointer` is in content coordinates; the edge bands are in viewport
      // coordinates. This is the conversion, and it is the only place the two
      // coordinate spaces meet.
      const delta = autoScrollDelta(state.pointer.y - (offset ?? 0), height);
      if (delta !== 0) scroll(delta);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [drag.phase]);

  // The other half of autoscroll: keeping the pointer honest while the board
  // moves under a finger that has not.
  //
  // A stationary finger produces no touch events, so nothing else would ever
  // update `pointer` during an autoscroll — the caret and the preview would sit
  // at a content position the board had slid out from under. The synthetic move
  // goes through `dragReduce` like any other, so the drop target is recomputed
  // against the rows that have just scrolled into view. That is the point of it,
  // not a side effect.
  //
  // Reading `scrollY` from the prop rather than the ref is deliberate: this
  // effect exists precisely *because* the offset changed, so it must be the
  // thing that wakes it. The frame loop above reads the ref for the opposite
  // reason.
  //
  // This cannot run away. `pointerAfterScroll` shifts the pointer by exactly
  // the distance the content moved, so the viewport position the frame loop
  // then reads back is unchanged and the next frame asks for the same delta:
  // the board glides at a constant speed rather than accelerating. It ends when
  // the drag does, or when the scroller hits the content bounds and stops
  // moving — an observed change of zero sends no event at all.
  const correctedScrollY = useRef(scrollY ?? 0);
  useEffect(() => {
    const offset = scrollY ?? 0;
    const previous = correctedScrollY.current;
    correctedScrollY.current = offset;

    // Reads `dragRef`, not `drag`, so the correction is judged against the
    // phase as it is now rather than as it was when this effect was created.
    const point = pointerAfterScroll(dragRef.current, previous, offset);
    if (!point) return;

    send({ type: "move", at: { point, time: Date.now() }, layout: layoutRef.current });
  }, [scrollY, send]);

  useEffect(() => clearHold, [clearHold]);

  return { drag, handlers };
}
