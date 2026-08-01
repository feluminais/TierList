import type { TierList, TierListAction } from "@tl/core";
import { layoutBoard } from "@tl/editor-core";
import React, { useEffect, useMemo } from "react";
import { View } from "react-native";
import { TierBoard } from "./TierBoard";
import { useBoardGesture } from "./useBoardGesture";

export interface InteractiveBoardProps {
  doc: TierList;
  width: number;
  onAction: (action: TierListAction) => void;
  onTap?: (itemId: string) => void;
  viewportHeight?: number;
  scrollY?: number;
  onAutoScroll?: (delta: number) => void;
  /**
   * Fired when a drag starts and again when it ends.
   *
   * A parent scroll container has to know, and cannot infer it. On Android a
   * native `ScrollView` decides for itself when to claim a touch stream: past
   * the platform touch slop it intercepts, calls
   * `NativeGestureUtil.notifyNativeGestureStarted`, and the resulting
   * `topTouchCancel` terminates the JS responder **without consulting
   * `onResponderTerminationRequest`** (`ReactScrollView.onInterceptTouchEvent`
   * -> `handleInterceptedTouchEvent`; the termination request is only reachable
   * through responder negotiation). So `onResponderTerminationRequest` is not,
   * by itself, enough to hold a drag against a scroller — a drag would be
   * cancelled the moment the finger moved.
   *
   * The lever that does work is the scroller's own `scrollEnabled`: it returns
   * `false` from `onInterceptTouchEvent` before anything else is considered,
   * while leaving programmatic `scrollTo` — which is how autoscroll drives it —
   * untouched. A parent should turn scrolling off for exactly the span this
   * reports.
   */
  onDraggingChange?: (dragging: boolean) => void;
}

/**
 * A board you can drag tiles on.
 *
 * The layout is computed once here and handed to both the renderer and the
 * gesture machine, so what is drawn and what is hit-tested cannot drift apart.
 *
 * The wrapping View is load-bearing geometry, not a container. `locationX` and
 * `locationY` are reported relative to the view the touch is over, so this View
 * must be exactly the board: sized to the layout, holding the canvas alone,
 * flush at its origin, with no padding, border or transform. Anything that
 * moved the canvas within it -- or any sibling the finger could stray onto --
 * would offset every point the drag machine is given, and a drag would target
 * the wrong row without anything failing loudly.
 */
export function InteractiveBoard({
  doc,
  width,
  onAction,
  onTap,
  viewportHeight,
  scrollY,
  onAutoScroll,
  onDraggingChange,
}: InteractiveBoardProps) {
  const layout = useMemo(() => layoutBoard(doc, { width }), [doc, width]);

  const { drag, handlers } = useBoardGesture({
    layout,
    onAction,
    onTap,
    viewportHeight,
    scrollY,
    onAutoScroll,
  });

  // Narrowed to a boolean before it becomes a dependency, so a parent is told
  // once per drag rather than once per frame the pointer moves.
  const dragging = drag.phase === "dragging";
  useEffect(() => {
    onDraggingChange?.(dragging);
  }, [dragging, onDraggingChange]);

  return (
    <View style={{ width, height: layout.contentHeight }} {...handlers}>
      <TierBoard doc={doc} width={width} layout={layout} drag={drag} />
    </View>
  );
}
