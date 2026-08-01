import type { TierList } from "@tl/core";
import { layoutBoard, type BoardLayout } from "@tl/editor-core";
import { Canvas, Fill, Group, Rect } from "@shopify/react-native-skia";
import React, { useMemo } from "react";
import { BOARD_BACKGROUND, BOARD_LINE, tileFill } from "./theme";

export interface TierBoardProps {
  doc: TierList;
  /** Width available to the board, in px. Height follows from the content. */
  width: number;
  /** Supplied by the caller so the same layout can be reused for hit-testing. */
  layout?: BoardLayout;
}

/**
 * Draws a tier list. Computes no geometry of its own: every rectangle comes
 * from `layoutBoard`, which is also what hit-testing and drag targeting read.
 * A renderer that positioned tiles itself could drift from where a drop lands,
 * and that class of bug is invisible until someone misses a tile by 4px.
 *
 * Interaction belongs to Milestone 2C. This paints and nothing else.
 */
export function TierBoard({ doc, width, layout }: TierBoardProps) {
  const board = useMemo(
    () => layout ?? layoutBoard(doc, { width }),
    [layout, doc, width],
  );

  const itemsById = useMemo(
    () => new Map(doc.items.map((i) => [i.id, i])),
    [doc.items],
  );

  const rowsById = useMemo(
    () => new Map(doc.rows.map((r) => [r.id, r])),
    [doc.rows],
  );

  return (
    <Canvas style={{ width, height: board.contentHeight }}>
      <Fill color={BOARD_BACKGROUND} />

      {board.rows.map((row) => {
        const model = rowsById.get(row.rowId);
        return (
          <Group key={row.rowId}>
            <Rect
              x={row.labelRect.x}
              y={row.labelRect.y}
              width={row.labelRect.width}
              height={row.labelRect.height}
              color={model?.color ?? BOARD_LINE}
            />
            {row.tiles.map((tile) => {
              const item = itemsById.get(tile.itemId);
              // A placement can outlive its item on a document that reached us
              // without passing through the reducer — see the migrate()
              // validation gap in STATE.md. Skip rather than draw a hole.
              if (!item) return null;
              return (
                <Rect
                  key={tile.itemId}
                  x={tile.rect.x}
                  y={tile.rect.y}
                  width={tile.rect.width}
                  height={tile.rect.height}
                  color={tileFill(item)}
                />
              );
            })}
          </Group>
        );
      })}

      <Rect
        x={board.tray.rect.x}
        y={board.tray.rect.y}
        width={board.tray.rect.width}
        height={board.tray.rect.height}
        color={BOARD_LINE}
      />
      {board.tray.tiles.map((tile) => {
        const item = itemsById.get(tile.itemId);
        if (!item) return null;
        return (
          <Rect
            key={tile.itemId}
            x={tile.rect.x}
            y={tile.rect.y}
            width={tile.rect.width}
            height={tile.rect.height}
            color={tileFill(item)}
          />
        );
      })}
    </Canvas>
  );
}
