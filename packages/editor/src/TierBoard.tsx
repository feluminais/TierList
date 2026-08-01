import type { TierList } from "@tl/core";
import { layoutBoard, type BoardLayout, type TileBox } from "@tl/editor-core";
import { Canvas, Fill, Group, Rect, Text } from "@shopify/react-native-skia";
import React, { useMemo } from "react";
import {
  BOARD_BACKGROUND,
  BOARD_LINE,
  ROW_LABEL_TEXT,
  TILE_TEXT,
  tileFill,
  tileFontSize,
  rowFontSize,
  truncate,
} from "./theme";
import { useBoardFont } from "./useBoardFont";

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

  // One size per font object, fixed: a size is baked into an SkFont at load
  // time, and hooks cannot run per row.
  const firstRow = board.rows[0];
  const rowSize = firstRow
    ? rowFontSize(firstRow.labelRect.width, firstRow.rect.height)
    : 24;
  const tileSize = tileFontSize(doc.display.tileSize);

  const rowFont = useBoardFont(rowSize);
  const tileFont = useBoardFont(tileSize);

  // Skia positions text on its baseline, not its top edge. `ascent` is
  // negative and `descent` positive, so the glyph box is centred on the row
  // when the baseline sits this far below the row's midpoint. Read from the
  // font rather than approximated as size/3 — it costs one JSI call per
  // render and is only reachable where the font is already non-null, so it
  // adds nothing to the loading path.
  const rowBaselineOffset = useMemo(() => {
    if (!rowFont) return 0;
    const { ascent, descent } = rowFont.getMetrics();
    return -(ascent + descent) / 2;
  }, [rowFont]);

  // Row tiles and tray tiles are drawn identically; only their source list
  // differs. Keeping one helper means a label change cannot land in one place
  // and not the other.
  const drawTile = (tile: TileBox, i: number) => {
    const item = itemsById.get(tile.itemId);
    // A placement can outlive its item on a document that reached us without
    // passing through the reducer — see the migrate() validation gap in
    // STATE.md. Skip rather than draw a hole.
    if (!item) return null;
    return (
      // Position is part of the key because migrate() performs no structural
      // validation, so the same item can appear twice in one location. A bare
      // itemId would collide there.
      <Group key={`${tile.itemId}:${i}`}>
        <Rect
          x={tile.rect.x}
          y={tile.rect.y}
          width={tile.rect.width}
          height={tile.rect.height}
          color={tileFill(item)}
        />
        {tileFont && doc.display.showLabels ? (
          <Text
            x={tile.rect.x + 4}
            // Bottom-aligned rather than centred: an image tile's label must
            // not sit over the middle of the picture once Milestone 3 draws
            // one there.
            y={tile.rect.y + tile.rect.height - 6}
            text={truncate(item.label ?? "", tile.rect.width - 8, tileSize)}
            font={tileFont}
            color={TILE_TEXT}
          />
        ) : null}
      </Group>
    );
  };

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
            {/*
              Not gated on doc.display.showLabels: per its docblock in
              @tl/core's types, that flag governs item labels only. The row
              label column is collapsed by labelWidth: 0 instead.
            */}
            {rowFont && model ? (
              <Text
                x={row.labelRect.x + 8}
                y={row.labelRect.y + row.labelRect.height / 2 + rowBaselineOffset}
                text={truncate(model.label, row.labelRect.width - 16, rowSize)}
                font={rowFont}
                color={ROW_LABEL_TEXT}
              />
            ) : null}
            {row.tiles.map(drawTile)}
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
      {board.tray.tiles.map(drawTile)}
    </Canvas>
  );
}
