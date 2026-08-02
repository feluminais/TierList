import type { Item } from "@tl/core";
import {
  strokeWidthInTile,
  toTilePoint,
  type Rect as GeometryRect,
} from "@tl/editor-core";
import { Path, Skia } from "@shopify/react-native-skia";
import React from "react";

/**
 * An item's committed strokes, mapped from source-normalized coordinates
 * into `dest` (a tile's own space) via `toTilePoint`.
 *
 * Shared between `EditCanvas`, which blows one tile up to fill a sheet, and
 * `TierBoard`, which draws every tile on the board, so the mapping and the
 * `Path` construction cannot drift between the two.
 *
 * Rendered whenever an item has strokes, regardless of whether it has an image
 * or whether that image is ready: a text tile, or an image tile still loading
 * or failed to decode, still owns whatever was drawn on it. Callers clip to
 * the tile; this draws unclipped, so a stroke made before a tighter crop still
 * exists for whoever wraps it to clip away.
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
            strokeWidth={strokeWidthInTile(stroke.width, dest, item.edit.crop)}
            strokeCap="round"
            strokeJoin="round"
          />
        );
      })}
    </>
  );
}
