import type { TierList, TierListAction } from "@tl/core";
import { exportPlan, layoutBoard, type BoardLayout } from "@tl/editor-core";
import type { CanvasRef, SkTypeface } from "@shopify/react-native-skia";
import React, { useEffect, useMemo, useRef } from "react";
import { View } from "react-native";
import { encodeBoardImage, type BoardExporter } from "./export";
import { renderBoardImage } from "./renderExport";
import { TierBoard } from "./TierBoard";
import { useBoardGesture } from "./useBoardGesture";
import { useImageCache } from "./useImageCache";

export interface InteractiveBoardProps {
  doc: TierList;
  width: number;
  onAction: (action: TierListAction) => void;
  onTap?: (itemId: string) => void;
  viewportHeight?: number;
  scrollY?: number;
  onAutoScroll?: (delta: number) => void;
  /**
   * Asset ids to keep decoded, and where to fetch one from.
   *
   * `useImageCache` has to run in a component that is only ever mounted after
   * CanvasKit is on the global — see `SkiaHost`'s module-scope-import
   * constraint — so this is the component that holds it, not the caller.
   * Optional and defaulted below, so a consumer that has not wired uploads
   * yet (a story, a test) does not have to supply either.
   */
  assetIds?: readonly string[];
  assetUrl?: (assetId: string) => string;
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
  /**
   * Lets a press begin dragging on movement alone, without the touch hold.
   * See `useBoardGesture`'s option of the same name. Left to the caller
   * rather than detected here: this component is shared with the Android
   * app, and only a web caller can tell a mouse from a touch screen.
   */
  immediateDrag?: boolean;
  /**
   * Handed an exporter once the canvas exists, and `null` on unmount.
   *
   * A callback rather than a ref the host creates, because the host cannot:
   * `apps/web`'s `SkiaHost` must not evaluate this package at module scope
   * (CanvasKit has to be on the global first), so it has no way to name a
   * `CanvasRef` or reach `encodeBoardImage`. It receives a plain object with
   * one method instead, the same way it receives the components themselves.
   *
   * Must be a stable reference — it keys the effect below.
   */
  onExporterReady?: (exporter: BoardExporter | null) => void;
  /**
   * The layout to render and hit-test against.
   *
   * Optional, and computed here when absent. A caller supplies one when it
   * also draws overlays over the board: everything that positions itself in
   * board coordinates has to read the *same* layout, or a handle sits where a
   * tile is not. Recomputing it per consumer from the same inputs works only
   * until one of them passes a different option.
   */
  layout?: BoardLayout;
  /** A mark still under the pen, passed straight through to the renderer. */
  liveAnnotation?: { points: number[]; color: string; width: number } | null;
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
  immediateDrag,
  onExporterReady,
  layout: providedLayout,
  liveAnnotation,
  assetIds = EMPTY_ASSET_IDS,
  assetUrl = emptyAssetUrl,
}: InteractiveBoardProps) {
  const ownLayout = useMemo(() => layoutBoard(doc, { width, responsive: true }), [doc, width]);
  const layout = providedLayout ?? ownLayout;

  const { drag, handlers } = useBoardGesture({
    layout,
    onAction,
    onTap,
    viewportHeight,
    scrollY,
    onAutoScroll,
    immediateDrag,
  });

  // Narrowed to a boolean before it becomes a dependency, so a parent is told
  // once per drag rather than once per frame the pointer moves.
  const dragging = drag.phase === "dragging";
  useEffect(() => {
    onDraggingChange?.(dragging);
  }, [dragging, onDraggingChange]);

  const images = useImageCache(assetIds, assetUrl);

  // Reads `canvasRef.current` at call time rather than closing over it, so the
  // exporter object stays valid for the component's whole life and the host is
  // told exactly twice — once on mount and once on unmount — instead of on
  // every render that replaced the canvas.
  const canvasRef = useRef<CanvasRef | null>(null);
  // What an offscreen export needs and the exporter must read at call time:
  // the document as it is now, the images decoded so far, and the faces the
  // board loaded.
  const typefacesRef = useRef<{ regular: SkTypeface | null; bold: SkTypeface | null }>({
    regular: null,
    bold: null,
  });
  const latest = useRef({ doc, images });
  useEffect(() => {
    latest.current = { doc, images };
  });
  useEffect(() => {
    if (!onExporterReady) return;
    onExporterReady({
      toImage: (format) => encodeBoardImage(canvasRef.current, format),
      plan: (settings) => exportPlan(latest.current.doc, settings),
      render: (settings, format) =>
        renderBoardImage({
          doc: latest.current.doc,
          plan: exportPlan(latest.current.doc, settings),
          images: latest.current.images,
          typefaces: typefacesRef.current,
          format,
        }),
    });
    return () => onExporterReady(null);
  }, [onExporterReady]);

  return (
    <View style={{ width, height: layout.contentHeight }} {...handlers}>
      <TierBoard
        doc={doc}
        width={width}
        layout={layout}
        drag={drag}
        images={images}
        liveAnnotation={liveAnnotation}
        canvasRef={canvasRef}
        typefacesRef={typefacesRef}
      />
    </View>
  );
}

// Stable references so a caller that never passes these props does not force
// `useImageCache` to re-key on a fresh array/closure every render.
const EMPTY_ASSET_IDS: readonly string[] = [];
function emptyAssetUrl(): string {
  return "";
}
