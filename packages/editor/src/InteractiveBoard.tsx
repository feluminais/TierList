import type { TierList, TierListAction } from "@tl/core";
import { layoutBoard } from "@tl/editor-core";
import React, { useMemo } from "react";
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

  return (
    <View style={{ width, height: layout.contentHeight }} {...handlers}>
      <TierBoard doc={doc} width={width} layout={layout} drag={drag} />
    </View>
  );
}
