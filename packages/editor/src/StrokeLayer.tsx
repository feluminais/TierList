import type { Item } from "@tl/core";
import { toTilePoint, type Rect as GeometryRect } from "@tl/editor-core";
import { Path, Skia } from "@shopify/react-native-skia";
import React from "react";

/**
 * An item's committed strokes, mapped from source-normalized coordinates
 * into `dest` (a tile's own space) via `toTilePoint`.
 *
 * Shared between `EditCanvas` (one tile blown up to fill a sheet) and
 * `TierBoard` (every tile on the board), so the mapping and the `Path`
 * construction cannot drift between the two call sites the way they did
 * before this file existed: strokes must render whenever an item has any,
 * regardless of whether it has an image or that image is ready — a text
 * tile, or an image tile still loading or that failed to decode, still owns
 * whatever was drawn on it. Callers are responsible for clipping to the
 * tile; this component draws unclipped so a stroke from before a tighter
 * crop still exists to be clipped by whoever wraps it.
 */
export function StrokeLayer({ item, dest }: { item: Item; dest: GeometryRect }) {
  return (
    <>
      {item.edit.strokes.map((stroke) => {
        const path = Skia.Path.Make();
        for (let p = 0; p + 1 < stroke.points.length; p += 2) {
          const point = toTilePoint(
            { x: stroke.points[p]!, y: stroke.points[p + 1]! },
            dest,
            item.edit.crop,
          );
          if (p === 0) path.moveTo(point.x, point.y);
          else path.lineTo(point.x, point.y);
        }
        return (
          <Path
            key={stroke.id}
            path={path}
            color={stroke.color}
            style="stroke"
            strokeWidth={stroke.width}
            strokeCap="round"
            strokeJoin="round"
          />
        );
      })}
    </>
  );
}
