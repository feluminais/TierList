import type { Item, TierList } from "@tl/core";
import {
  dragPreviewRect,
  imageDrawRect,
  imagePlacement,
  insertionCaretRect,
  layoutBoard,
  type BoardLayout,
  type DragState,
  type Rect as GeometryRect,
  type TileBox,
} from "@tl/editor-core";
import {
  Canvas,
  Fill,
  Group,
  Image,
  Rect,
  Text,
  rect,
  type CanvasRef,
  type SkImage,
} from "@shopify/react-native-skia";
import React, { useMemo } from "react";
import { StrokeLayer } from "./StrokeLayer";
import {
  BOARD_BACKGROUND,
  BOARD_LINE,
  CARET,
  PREVIEW_BORDER,
  ROW_LABEL_TEXT,
  TILE_TEXT,
  tileFill,
  tileFontSize,
  rowFontSize,
  truncate,
} from "./theme";
import { useBoardFont } from "./useBoardFont";
import type { ImageCache, ImageEntry } from "./useImageCache";

/**
 * How visible the tile a drag was lifted from stays while the drag is in
 * flight. Faint enough to read as a vacated slot rather than a second copy of
 * the item, solid enough that the row does not appear to have lost a tile.
 */
const LIFTED_TILE_OPACITY = 0.28;

export interface TierBoardProps {
  doc: TierList;
  /** Width available to the board, in px. Height follows from the content. */
  width: number;
  /** Supplied by the caller so the same layout can be reused for hit-testing. */
  layout?: BoardLayout;
  /** The gesture in flight, if any. Drawn on top of an unchanged board. */
  drag?: DragState;
  /**
   * Decoded images by `assetId`. Optional: the board renders perfectly well
   * without it, showing every image tile in its loading state, which is what
   * a consumer that has not wired uploads yet should see.
   */
  images?: ImageCache;
  /**
   * A handle on the underlying Skia canvas, for `encodeBoardImage`.
   *
   * Passed down rather than exposed through an imperative handle on this
   * component: what an export needs is the canvas itself, and adding a layer
   * that forwards one method would only be somewhere for the two to drift.
   */
  canvasRef?: React.Ref<CanvasRef>;
}

/**
 * Draws a tier list. Computes no geometry of its own: every rectangle comes
 * from `layoutBoard`, which is also what hit-testing and drag targeting read.
 * A renderer that positioned tiles itself could drift from where a drop lands,
 * and that class of bug is invisible until someone misses a tile by 4px.
 *
 * This still owns no interaction: `drag` is a state someone else produced, and
 * where the caret and the floating tile go is `@tl/editor-core`'s arithmetic,
 * not this file's. `InteractiveBoard` is what turns touches into that state.
 */
export function TierBoard({ doc, width, layout, drag, images, canvasRef }: TierBoardProps) {
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

  // Both are null unless a drag is under way, and both read the same layout
  // the board is drawn from — so the bar marks the slot a drop would actually
  // land in rather than one this file guessed at.
  const caret = useMemo(
    () => (drag?.phase === "dragging" ? insertionCaretRect(board, drag.target) : null),
    [board, drag],
  );
  const preview = useMemo(
    () => (drag ? dragPreviewRect(board, drag) : null),
    [board, drag],
  );
  const draggedItem = drag?.phase === "dragging" ? itemsById.get(drag.itemId) : undefined;

  /**
   * A tile's image, scaled and offset by `imageDrawRect` so the cropped
   * region covers the tile. Does not clip and does not draw strokes — see
   * `drawTile`, which wraps this (when there is an image to draw) and
   * `StrokeLayer` (always) in one clipping `Group`, so strokes render
   * whether or not the tile has a ready image.
   */
  const drawTileImage = (item: Item, image: SkImage, dest: GeometryRect) => {
    const size = { width: image.width(), height: image.height() };
    const placement = imagePlacement(size, item.edit, dest);
    const draw = imageDrawRect(placement, size);

    return (
      <Image
        image={image}
        x={draw.x}
        y={draw.y}
        width={draw.width}
        height={draw.height}
        fit="fill"
      />
    );
  };

  /**
   * Everything inside a tile: its fill, its image, its strokes and its label.
   *
   * Shared by the board's tiles and by the drag preview, so a tile cannot look
   * like one thing in place and something else under the finger.
   */
  const drawTileContent = (item: Item, dest: GeometryRect, entry: ImageEntry | undefined) => {
    const ready = entry?.status === "ready" ? entry.image : null;
    return (
      <>
        <Rect
          x={dest.x}
          y={dest.y}
          width={dest.width}
          height={dest.height}
          color={tileFill(item, entry?.status)}
        />
        <Group clip={rect(dest.x, dest.y, dest.width, dest.height)}>
          {ready ? drawTileImage(item, ready, dest) : null}
          <StrokeLayer item={item} dest={dest} />
        </Group>
        {tileFont && doc.display.showLabels ? (
          <Text
            x={dest.x + 4}
            // Bottom-aligned rather than centred, so it does not sit over the
            // middle of the picture.
            y={dest.y + dest.height - 6}
            text={truncate(item.label ?? "", dest.width - 8, tileSize)}
            font={tileFont}
            color={TILE_TEXT}
          />
        ) : null}
      </>
    );
  };

  // Row tiles and tray tiles are drawn identically; only their source list
  // differs. Keeping one helper means a label change cannot land in one place
  // and not the other.
  const drawTile = (tile: TileBox, i: number) => {
    const item = itemsById.get(tile.itemId);
    // Skip rather than draw a hole. A valid document has no placement without
    // an item, but a renderer that assumed it would crash on one.
    if (!item) return null;

    // The tile this drag lifted. It stays drawn — the document does not change
    // until the drop, so removing it here would make the board flicker and
    // would be a second source of truth about where the item is. But drawn at
    // full strength it reads as a *copy* rather than as the thing being moved,
    // so it is faded to say "this came from here".
    const lifted = drag?.phase === "dragging" && drag.itemId === item.id;

    return (
      // Position is part of the key so that a document holding the same item
      // twice in one location still produces distinct keys.
      <Group key={`${tile.itemId}:${i}`} opacity={lifted ? LIFTED_TILE_OPACITY : 1}>
        {drawTileContent(item, tile.rect, item.assetId ? images?.get(item.assetId) : undefined)}
      </Group>
    );
  };

  return (
    <Canvas ref={canvasRef} style={{ width, height: board.contentHeight }}>
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

      {/*
        Last, so the drag paints over everything. Skia's DOM draws in document
        order with no z-index on these nodes, so position here *is* the
        stacking order — a caret drawn before the rows would be hidden by the
        very tiles it is pointing between.
      */}
      {caret ? (
        <Rect
          x={caret.x}
          y={caret.y}
          width={caret.width}
          height={caret.height}
          color={CARET}
        />
      ) : null}

      {preview && draggedItem ? (
        <Group>
          {/*
            The same content the tile draws in place, not an approximation of
            it: a drag that showed a blank box for a picture is exactly what
            this shares `drawTileContent` to prevent.
          */}
          {drawTileContent(
            draggedItem,
            preview,
            draggedItem.assetId ? images?.get(draggedItem.assetId) : undefined,
          )}
          {/*
            The tile is still drawn in place underneath, faded — the document
            does not change until the drop. The border is what marks this as
            the copy under the finger rather than the one it was lifted from.
          */}
          <Rect
            x={preview.x}
            y={preview.y}
            width={preview.width}
            height={preview.height}
            color={PREVIEW_BORDER}
            style="stroke"
            strokeWidth={2}
          />
        </Group>
      ) : null}
    </Canvas>
  );
}
