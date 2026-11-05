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

/** Tiles a responsive layout tries to fit on one line of a tier. */
const RESPONSIVE_COLUMNS = 3;
/** The share of a narrow board the label column may take when responsive. */
const RESPONSIVE_LABEL_SHARE = 0.2;

/**
 * What a tile may be scaled to, in px.
 *
 * The bounds live here, beside the layout that consumes the number, so every
 * control that sets one — a slider, a corner drag — clamps to the same pair
 * rather than each carrying its own copy. Below the floor a tile is too small
 * to recognise a picture in; above the ceiling a single tier fills the window
 * and the list stops being scannable, which is the whole point of a tier list.
 *
 * `layoutBoard` does not clamp to these. A stored document can carry any size
 * — nothing validates one — and silently redrawing it at a different size
 * would make the board disagree with the document it is rendering.
 */
export const MIN_TILE_SIZE = 48;
export const MAX_TILE_SIZE = 240;

/** Clamp a proposed tile size into the range controls are allowed to set. */
export function clampTileSize(size: number): number {
  if (!Number.isFinite(size)) return MIN_TILE_SIZE;
  return Math.min(Math.max(Math.round(size), MIN_TILE_SIZE), MAX_TILE_SIZE);
}

/**
 * What the tier label column may be widened or narrowed to, in px.
 *
 * The floor keeps a letter and its corner grip on screen — below it the column
 * is a stripe nothing can be grabbed by. The ceiling stops the labels eating
 * the board: `layoutBoard` already refuses to leave less than `MIN_TILES_WIDTH`
 * for the tiles, but that is a last resort at render time, and a control that
 * lets you drag past the point where anything happens feels broken.
 */
export const MIN_LABEL_WIDTH = 56;
export const MAX_LABEL_WIDTH = 320;

/** Clamp a proposed label-column width into the range controls may set. */
export function clampLabelWidth(width: number): number {
  if (!Number.isFinite(width)) return MIN_LABEL_WIDTH;
  return Math.min(Math.max(Math.round(width), MIN_LABEL_WIDTH), MAX_LABEL_WIDTH);
}

export interface LayoutOptions {
  /** Width available to the whole board, in px. */
  width: number;
  /** Space left outside the board's content on every side, in px. */
  padding?: number;
  /**
   * Reserve a tile-sized slot at the front of the tray for an "add" control.
   *
   * The layout owns this rather than the caller drawing a button wherever it
   * likes, for the same reason every other rectangle comes from here: the slot
   * displaces every tray tile after it, so a caller positioning one
   * independently would put it on top of the first item. It is returned as
   * `tray.addSlot` and is deliberately *not* a tile — hit-testing does not
   * report it, and nothing can be dropped into it.
   */
  trayAddSlot?: boolean;
  /**
   * Fit the board to a narrow width instead of laying the document's sizes out
   * as stored.
   *
   * The label column yields a share of a narrow board and tiles shrink, in
   * proportion and never below `MIN_TILE_SIZE`, until three fit on a line — so
   * a phone shows a usable board rather than two tiles to a tier. It only ever
   * reduces: once the document's own sizes fit, the layout is exactly the one
   * without this option, so widening the board never makes a tile smaller.
   *
   * This is how the board is drawn, not what the document says. Nothing is
   * written back, and every consumer of a layout must be given the same options
   * or they will disagree about where a tile is.
   */
  responsive?: boolean;
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
   * Where an "add item" control goes, when one was asked for. Sized and
   * positioned exactly as the tile that would otherwise sit there.
   */
  addSlot?: Rect;
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
  /** The reserved leading slot, when one was asked for. */
  leadingRect?: Rect;
  /**
   * Height of the area the tiles were laid into: a gap above the first line,
   * one below the last, and one between each pair. Never less than a single
   * line, so an empty location is still a target big enough to hit.
   */
  height: number;
}

/**
 * A tile no wider than the room a line has, with its aspect kept.
 *
 * A line holds at least one tile however narrow the area, so an area narrower
 * than one tile plus its gaps would push that tile past the area's edge, where
 * hit testing finds it and drop targeting does not. Shrinking it to fit keeps
 * every tile inside the location it belongs to.
 */
function fitTile(tile: Size, areaWidth: number, gap: number): Size {
  const room = Math.max(0, areaWidth - gap * 2);
  if (room >= tile.width) return tile;
  return {
    width: room,
    height: Math.round(tile.height * (room / tile.width)),
  };
}

function layoutTiles(
  itemIds: string[],
  area: Pick<Rect, "x" | "y" | "width">,
  wanted: Size,
  gap: number,
  /** Slots occupied before the first tile — currently only the tray's add
   *  control, which takes a tile's place and pushes every item along. */
  leading = 0,
): LaidTiles {
  const tile = fitTile(wanted, area.width, gap);
  const columns = columnsIn(area.width, tile.width, gap);

  const slotRect = (position: number): Rect => ({
    // Never past the area's right edge: with no room for a tile this leaves a
    // zero-width one at the edge rather than one beyond it.
    x: Math.min(
      area.x + gap + (position % columns) * (tile.width + gap),
      area.x + area.width - tile.width,
    ),
    y: area.y + gap + Math.floor(position / columns) * (tile.height + gap),
    width: tile.width,
    height: tile.height,
  });

  const tiles = itemIds.map((itemId, position) => ({
    itemId,
    rect: slotRect(position + leading),
  }));

  // At least one line, so an empty location is still a target big enough to
  // hit. This is what makes the height a floor as well as a measurement:
  // one line is exactly `tile.height + gap * 2`, the smallest a location that
  // can hold a tile could sensibly be.
  const lines = Math.max(1, Math.ceil((itemIds.length + leading) / columns));
  return {
    tiles,
    height: lines * (tile.height + gap) + gap,
    leadingRect: leading > 0 ? slotRect(0) : undefined,
  };
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

  // A responsive board lets the label take only a share of a narrow width.
  const wantedLabel = options.responsive
    ? Math.min(
        doc.display.labelWidth,
        Math.max(MIN_LABEL_WIDTH, Math.round(boardWidth * RESPONSIVE_LABEL_SHARE)),
      )
    : doc.display.labelWidth;

  // The label yields before the tiles area becomes unusable, so a narrow
  // phone loses label width rather than losing the ability to drop.
  const labelWidth = Math.max(0, Math.min(wantedLabel, boardWidth - MIN_TILES_WIDTH));

  // How much a responsive board shrinks every tile: enough that
  // `RESPONSIVE_COLUMNS` fit across a tier, never below `MIN_TILE_SIZE`, never
  // larger than the document asks. One factor for all of them, so tiers keep
  // their sizes relative to each other.
  const scale = options.responsive
    ? Math.min(
        1,
        Math.max(
          MIN_TILE_SIZE,
          Math.floor((boardWidth - labelWidth - gap) / RESPONSIVE_COLUMNS) - gap,
        ) / doc.display.tileSize,
      )
    : 1;
  const scaled = (size: number) =>
    scale === 1 ? size : Math.max(Math.min(size, MIN_TILE_SIZE), Math.round(size * scale));

  const byLocation = groupByLocation(doc);
  const orderedRows = [...doc.rows].sort((a, b) => a.order - b.order);

  let y = padding;
  const rows: RowBox[] = [];

  for (const row of orderedRows) {
    const tile = tileSizeFor(
      scaled(row.tileSizeOverride ?? doc.display.tileSize),
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
  const trayTile = tileSizeFor(scaled(doc.display.tileSize), doc.display.tileAspect);
  const trayArea = { x: padding, y, width: boardWidth };
  const trayLaid = layoutTiles(
    byLocation.get(null) ?? [],
    trayArea,
    trayTile,
    gap,
    options.trayAddSlot ? 1 : 0,
  );

  const tray: TrayBox = {
    rect: { x: padding, y, width: boardWidth, height: trayLaid.height },
    tilesRect: { ...trayArea, height: trayLaid.height },
    tiles: trayLaid.tiles,
    ...(trayLaid.leadingRect ? { addSlot: trayLaid.leadingRect } : null),
  };

  // Padding on the bottom as well as the top, matching the horizontal axis
  // where `boardWidth` reserves it on both sides. Scroll extent is the one
  // place the far edge is observable, so leaving it out would show as a board
  // that is inset at the top and flush at the bottom.
  return { rows, tray, contentHeight: y + trayLaid.height + padding };
}
