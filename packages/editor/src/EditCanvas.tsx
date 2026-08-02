import type { Item } from "@tl/core";
import { imageDrawRect, imagePlacement, type Rect as GeometryRect } from "@tl/editor-core";
import { Canvas, Fill, Group, Image, Path, Skia, rect } from "@shopify/react-native-skia";
import React, { useMemo } from "react";
import { StrokeLayer } from "./StrokeLayer";
import { BOARD_BACKGROUND, tileFill } from "./theme";
import { useImageCache } from "./useImageCache";

/** A stroke not yet committed to the document, already in this canvas's own
 *  coordinate space — see `EditSheet`'s comment on why that mapping happens
 *  before this component ever sees the points. */
export interface LiveStroke {
  points: number[]; // flat [x0, y0, x1, y1, …], canvas-space
  color: string;
  width: number;
}

export interface EditCanvasProps {
  item: Item;
  /**
   * The canvas's own size, in css px.
   *
   * Both dimensions, rather than one square `size`. The canvas *is* the tile
   * (see below), and a tile is only square when `display.tileAspect` says so —
   * so a square sheet showing a portrait tile would draw a different crop of
   * the image than the board does, and every crop the user framed here would
   * land on the board with its top and bottom cut off. Once `tileAspect` is
   * reachable from the toolbar that stops being hypothetical.
   */
  width: number;
  height: number;
  assetUrl: (assetId: string) => string;
  liveStroke: LiveStroke | null;
}

/**
 * The pen sheet's canvas: one tile, blown up.
 *
 * This is deliberately not `TierBoard` reused at a bigger size — a sheet edits
 * exactly one item and has no rows, no drag, no other tiles to lay out, so the
 * geometry is simply this canvas's own bounds. That is what lets
 * `editReduce` — the same pure machine either way — serve a 96px board tile
 * and a 600px sheet without knowing which one it is talking to.
 *
 * Loads its own copy of the image rather than sharing `InteractiveBoard`'s
 * cache: the two are separate React subtrees on opposite sides of the
 * dynamic-import boundary (`SkiaHost` cannot hold a cache created inside
 * `@tl/editor`, only pass the pieces needed to build one), and a second
 * decode of one image is a cost worth paying for not threading a cache
 * instance across that boundary.
 */
export function EditCanvas({ item, width, height, assetUrl, liveStroke }: EditCanvasProps) {
  const assetIds = useMemo(() => (item.assetId ? [item.assetId] : []), [item.assetId]);
  const images = useImageCache(assetIds, assetUrl);
  const entry = item.assetId ? images.get(item.assetId) : undefined;
  const ready = entry?.status === "ready" ? entry.image : null;

  // The canvas *is* the tile: no offset, no scale relative to the board.
  const dest: GeometryRect = { x: 0, y: 0, width, height };

  return (
    <Canvas style={{ width, height }}>
      <Fill color={ready ? BOARD_BACKGROUND : tileFill(item, entry?.status)} />
      {/*
        Always rendered, image or not: a text tile, or an image tile still
        loading or that failed to decode, still has to show its strokes and
        the one in progress — `ready` gates only the `<Image>` below. The
        clip stays unconditional too, for the same reason it is here at all:
        a stroke drawn before a tighter crop legitimately extends past the
        tile and must still be clipped.
      */}
      <Group clip={rect(dest.x, dest.y, dest.width, dest.height)}>
        {ready
          ? (() => {
              const source = { width: ready.width(), height: ready.height() };
              const placement = imagePlacement(source, item.edit, dest);
              const draw = imageDrawRect(placement, source);
              return (
                <Image
                  image={ready}
                  x={draw.x}
                  y={draw.y}
                  width={draw.width}
                  height={draw.height}
                  fit="fill"
                />
              );
            })()
          : null}

        <StrokeLayer item={item} dest={dest} />

        {/* The stroke still in the user's hand. Drawn last, over every
            committed one, and never written to the document until penUp —
            see EditSheet. */}
        {liveStroke ? (
          <Path
            path={livePath(liveStroke.points)}
            color={liveStroke.color}
            style="stroke"
            strokeWidth={liveStroke.width}
            strokeCap="round"
            strokeJoin="round"
          />
        ) : null}
      </Group>
    </Canvas>
  );
}

function livePath(points: number[]) {
  const path = Skia.Path.Make();
  for (let p = 0; p + 1 < points.length; p += 2) {
    if (p === 0) path.moveTo(points[p]!, points[p + 1]!);
    else path.lineTo(points[p]!, points[p + 1]!);
  }
  return path;
}
