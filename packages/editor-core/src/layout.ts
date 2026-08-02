import type { Density, TierList, TileAspect } from "@tl/core";
import type { Rect, Size } from "./geometry";

/** Space between tiles and around the inside of a row, in px. */
const GAP: Record<Density, number> = {
  compact: 2,
  normal: 6,
  roomy: 12,
};

/** height ÷ width. Portrait is taller than wide; landscape is wider than tall. */
const ASPECT_RATIO: Record<TileAspect, number> = {
  square: 1,
  portrait: 4 / 3,
  landscape: 3 / 4,
};

/** The narrowest the tiles area is allowed to get before the label gives way. */
const MIN_TILES_WIDTH = 40;

export interface LayoutOptions {
  /** Width available to the whole board, in px. */
  width: number;
  /** Space left outside the board's content on every side, in px. */
  padding?: number;
}

export interface TileBox {
  itemId: string;
  rect: Rect;
}

export interface RowBox {
  rowId: string;
  /** The whole row band: label and tiles together. */
  rect: Rect;
  labelRect: Rect;
  tilesRect: Rect;
  /** In placement index order, which is also reading order. */
  tiles: TileBox[];
}

export interface TrayBox {
  rect: Rect;
  /**
   * Equal to `rect`: the tray has no label column. Present so a consumer can
   * treat a tray and a row alike — hit-testing and drag targeting both want
   * "the area tiles live in" without caring which kind of location it is.
   */
  tilesRect: Rect;
  tiles: TileBox[];
}

export interface BoardLayout {
  rows: RowBox[];
  tray: TrayBox;
  /** Total height of the laid-out board, for scroll extent. */
  contentHeight: number;
}

export function tileSizeFor(base: number, aspect: TileAspect): Size {
  return { width: base, height: Math.round(base * ASPECT_RATIO[aspect]) };
}

/**
 * Height ÷ width for a tile aspect — the same convention `defaultCropFor`
 * (imagefit.ts) documents itself as matching. Exported rather than the raw
 * `ASPECT_RATIO` map so a caller that needs the number (deciding what crop to
 * lock an upload to, say) reads it from the one place `layoutBoard` itself
 * reads it, and the two cannot drift into disagreeing about what "portrait"
 * means.
 */
export function aspectRatioFor(tileAspect: TileAspect): number {
  return ASPECT_RATIO[tileAspect];
}

/**
 * How many tiles fit across `available`, given a gap on both outer edges and
 * between every pair. Never returns 0: a board too narrow for one tile still
 * has to render, and a zero column count would divide by zero downstream.
 */
function columnsIn(available: number, tileWidth: number, gap: number): number {
  return Math.max(1, Math.floor((available - gap) / (tileWidth + gap)));
}

interface LaidTiles {
  tiles: TileBox[];
  /**
   * Height of the area the tiles were laid into: a gap above the first line,
   * one below the last, and one between each pair. Never less than a single
   * line, so an empty location is still a target big enough to hit.
   */
  height: number;
}

function layoutTiles(
  itemIds: string[],
  area: Pick<Rect, "x" | "y" | "width">,
  tile: Size,
  gap: number,
): LaidTiles {
  const columns = columnsIn(area.width, tile.width, gap);

  const tiles = itemIds.map((itemId, position) => {
    const column = position % columns;
    const line = Math.floor(position / columns);
    return {
      itemId,
      rect: {
        x: area.x + gap + column * (tile.width + gap),
        y: area.y + gap + line * (tile.height + gap),
        width: tile.width,
        height: tile.height,
      },
    };
  });

  // At least one line, so an empty location is still a target big enough to
  // hit. This is what makes the height a floor as well as a measurement:
  // one line is exactly `tile.height + gap * 2`, the smallest a location that
  // can hold a tile could sensibly be.
  const lines = Math.max(1, Math.ceil(itemIds.length / columns));
  return { tiles, height: lines * (tile.height + gap) + gap };
}

/**
 * Item ids per location, in placement index order. `null` keys the tray —
 * a Map handles a null key directly, so the tray needs no sentinel.
 *
 * The sort is load-bearing, not belt-and-braces. The contiguity invariant on
 * `Placement` constrains the index *values*, not the order of the array they
 * sit in, and the two genuinely diverge: `migrateV1ToV2` renumbers placements
 * in place, so a schema 1 document whose array order disagreed with its
 * indices arrives here still disagreeing.
 */
function groupByLocation(doc: TierList): Map<string | null, string[]> {
  const groups = new Map<string | null, string[]>();
  for (const placement of [...doc.placements].sort((a, b) => a.index - b.index)) {
    const existing = groups.get(placement.rowId);
    if (existing) existing.push(placement.itemId);
    else groups.set(placement.rowId, [placement.itemId]);
  }
  return groups;
}

/**
 * The single source of geometry for the editor. Rendering, hit-testing and
 * drag targeting all read this and never compute a position themselves, so
 * they cannot disagree about where a tile is.
 */
export function layoutBoard(doc: TierList, options: LayoutOptions): BoardLayout {
  const gap = GAP[doc.display.density];
  const padding = options.padding ?? 0;
  const boardWidth = Math.max(0, options.width - padding * 2);

  // The label yields before the tiles area becomes unusable, so a narrow
  // phone loses label width rather than losing the ability to drop.
  const labelWidth = Math.max(
    0,
    Math.min(doc.display.labelWidth, boardWidth - MIN_TILES_WIDTH),
  );

  const byLocation = groupByLocation(doc);
  const orderedRows = [...doc.rows].sort((a, b) => a.order - b.order);

  let y = padding;
  const rows: RowBox[] = [];

  for (const row of orderedRows) {
    const tile = tileSizeFor(
      row.tileSizeOverride ?? doc.display.tileSize,
      doc.display.tileAspect,
    );
    const tilesArea = {
      x: padding + labelWidth,
      y,
      width: boardWidth - labelWidth,
    };
    const laid = layoutTiles(byLocation.get(row.id) ?? [], tilesArea, tile, gap);

    rows.push({
      rowId: row.id,
      rect: { x: padding, y, width: boardWidth, height: laid.height },
      labelRect: { x: padding, y, width: labelWidth, height: laid.height },
      tilesRect: { ...tilesArea, height: laid.height },
      tiles: laid.tiles,
    });

    y += laid.height;
  }

  // The tray always uses the document tile size: it is not a tier, so a
  // per-row override has nothing to say about it.
  const trayTile = tileSizeFor(doc.display.tileSize, doc.display.tileAspect);
  const trayArea = { x: padding, y, width: boardWidth };
  const trayLaid = layoutTiles(byLocation.get(null) ?? [], trayArea, trayTile, gap);

  const tray: TrayBox = {
    rect: { x: padding, y, width: boardWidth, height: trayLaid.height },
    tilesRect: { ...trayArea, height: trayLaid.height },
    tiles: trayLaid.tiles,
  };

  // Padding on the bottom as well as the top, matching the horizontal axis
  // where `boardWidth` reserves it on both sides. Scroll extent is the one
  // place the far edge is observable, so leaving it out would show as a board
  // that is inset at the top and flush at the bottom.
  return { rows, tray, contentHeight: y + trayLaid.height + padding };
}
