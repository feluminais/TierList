import { createTierList, reduce, type TierList, type TierListAction } from "@tl/core";
import { InteractiveBoard } from "@tl/editor";
import { useCallback, useRef, useState } from "react";
import {
  ScrollView,
  useWindowDimensions,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";

/**
 * The only place edge autoscroll is exercised, because it is the only place the
 * board sits in a scroll container.
 *
 * Three measurements have to reach the board for that to work: the viewport
 * height it compares the pointer against (`onLayout`), where the scroller
 * currently is (`onScroll`), and a way to move it (`scrollTo`). The board owns
 * none of them; this screen owns all three.
 */
export default function Home() {
  const { width } = useWindowDimensions();
  const [doc, setDoc] = useState<TierList>(sampleDoc);

  const scroller = useRef<ScrollView>(null);
  const [scrollY, setScrollY] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [dragging, setDragging] = useState(false);

  // The same offset as `scrollY`, kept in a ref because the autoscroll tick
  // needs it *now*. React state is a commit behind, and each frame's scroll
  // target is built from the last one — off a stale base the board would
  // re-request a position it has already reached and the glide would stall.
  const offset = useRef(0);

  const onAction = useCallback((action: TierListAction) => {
    setDoc((current) => reduce(current, action, new Date().toISOString()));
  }, []);

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = e.nativeEvent.contentOffset.y;
    offset.current = y;
    // Feeds two things: the next frame's edge calculation, and the drift
    // correction that keeps the pointer under a finger the board is moving
    // beneath. The correction is derived from this observed value precisely
    // because `scrollTo` is a request the scroller may clamp.
    setScrollY(y);
  }, []);

  const onAutoScroll = useCallback((delta: number) => {
    scroller.current?.scrollTo({ y: offset.current + delta, animated: false });
  }, []);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    setViewportHeight(e.nativeEvent.layout.height);
  }, []);

  return (
    <ScrollView
      ref={scroller}
      style={{ flex: 1, backgroundColor: "#0b0d10" }}
      onLayout={onLayout}
      onScroll={onScroll}
      // Android's native default is already 0 — unthrottled, one event per
      // frame (`OnScrollDispatchHelper` suppresses only duplicates). This is
      // for parity elsewhere; anything <= 16 is treated as no throttle, and a
      // throttled offset would make the drift correction visibly steppy.
      scrollEventThrottle={16}
      // The lever that actually keeps a drag alive.
      //
      // `onResponderTerminationRequest` cannot do it. Past the platform touch
      // slop the native `ReactScrollView` intercepts the touch stream itself,
      // calls `NativeGestureUtil.notifyNativeGestureStarted`, and the cancel
      // that follows terminates the JS responder without ever asking — the
      // termination request is only reachable through responder negotiation.
      // A drag would therefore die the moment the finger moved.
      //
      // `scrollEnabled: false` is checked first in `onInterceptTouchEvent`, so
      // the scroller never claims the gesture; and it does not gate `scrollTo`,
      // so autoscroll still drives it. Off only while a drag is under way, so
      // an ordinary swipe on the board still scrolls the page.
      scrollEnabled={!dragging}
    >
      <InteractiveBoard
        doc={doc}
        width={width}
        onAction={onAction}
        viewportHeight={viewportHeight}
        scrollY={scrollY}
        onAutoScroll={onAutoScroll}
        onDraggingChange={setDragging}
      />
    </ScrollView>
  );
}

/** A throwaway document so there is something to look at. Milestone 2D loads a real one. */
function sampleDoc(): TierList {
  const now = "2026-08-01T12:00:00.000Z";
  let doc = createTierList({ id: "preview", now });
  const labels = ["Ramen", "Udon", "Soba", "Pho", "Laksa", "Bun bo Hue"];
  labels.forEach((label, i) => {
    doc = reduce(doc, { type: "item/addText", id: `i${i}`, label }, now);
  });
  doc = reduce(doc, { type: "placement/place", itemId: "i0", rowId: "preview-row-0", index: 0 }, now);
  doc = reduce(doc, { type: "placement/place", itemId: "i1", rowId: "preview-row-0", index: 1 }, now);
  doc = reduce(doc, { type: "placement/place", itemId: "i2", rowId: "preview-row-1", index: 0 }, now);
  return doc;
}
