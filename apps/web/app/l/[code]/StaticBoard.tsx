import type { Item, Stroke, TierList } from "@tl/core";
import {
  imageDrawRect,
  imagePlacement,
  layoutBoard,
  strokeWidthInTile,
  toTilePoint,
  type Rect,
} from "@tl/editor-core";
import type { CSSProperties } from "react";

/**
 * The width the board is laid out against, in "board units".
 *
 * Nothing is rendered at this size. Every position below is divided by it and
 * emitted as a percentage, so the board scales fluidly to whatever the
 * container gives it — which is what lets this page be a single
 * server-rendered document with no measurement, no layout effect and no client
 * JavaScript. A fixed pixel board would need script to fit a phone.
 *
 * The value still matters: `layoutBoard` decides how many tiles fit per line
 * from it, so it sets the board's *shape* even though it sets none of its
 * pixels. This gives a desktop-like number of columns.
 */
const BOARD_UNITS = 1000;

/**
 * A tier list as plain HTML.
 *
 * Deliberately not the Skia renderer. CanvasKit is 2.9MB gzipped and the
 * design doc is explicit that public pages never load it — a link pasted in
 * Discord has to open fast, and a reader is not editing anything. What this
 * shares with the canvas instead is the thing that actually has to agree:
 * `layoutBoard`, plus `imagePlacement`/`imageDrawRect`/`toTilePoint` for what
 * goes inside a tile. Those are pure and are the single source of geometry, so
 * the public page and the editor cannot disagree about where a tile is or
 * which part of an image it shows — only about how the pixels get there.
 *
 * A server component: no "use client", no hooks, no state. It renders once,
 * into the HTML the crawler and the reader both receive.
 */
export function StaticBoard({
  doc,
  assetUrl,
  sources,
}: {
  doc: TierList;
  assetUrl: (assetId: string) => string;
  /**
   * Intrinsic pixel sizes by asset id, from `GET /shares/:code`.
   *
   * Load-bearing, and not substitutable with a placeholder. A crop is stored
   * as a *fraction of the source*, so `imagePlacement` produces a source
   * rectangle whose aspect ratio depends on the source's own, and
   * `imageDrawRect`'s cover scale takes the larger ratio over both axes — so
   * the source's shape decides which axis wins. Passing an arbitrary square
   * size does not cancel out: the magnitude does, the aspect does not, and the
   * image lands in the wrong place. An id missing from this map degrades to a
   * plain centred cover; see `ImageLayer`.
   */
  sources: ReadonlyMap<string, { width: number; height: number }>;
}) {
  const layout = layoutBoard(doc, { width: BOARD_UNITS });
  const itemsById = new Map(doc.items.map((i) => [i.id, i]));
  const rowsById = new Map(doc.rows.map((r) => [r.id, r]));

  /** A board-space rect as percentages of the board's own box. */
  const box = (rect: Rect): CSSProperties => ({
    position: "absolute",
    left: pct(rect.x / BOARD_UNITS),
    top: pct(rect.y / layout.contentHeight),
    width: pct(rect.width / BOARD_UNITS),
    height: pct(rect.height / layout.contentHeight),
  });

  const tile = (itemId: string, key: string) => {
    const item = itemsById.get(itemId);
    if (!item) return null;
    const rect = findRect(layout, itemId);
    if (!rect) return null;
    return (
      <div key={key} style={{ ...box(rect), ...tileStyle(item) }}>
        <TileContent item={item} rect={rect} assetUrl={assetUrl} sources={sources} />
        {doc.display.showLabels && item.label ? (
          <span style={{ ...tileLabel, fontSize: cqw(tileFontUnits(doc.display.tileSize)) }}>
            {item.label}
          </span>
        ) : null}
      </div>
    );
  };

  return (
    <div style={container}>
      <div
        style={{
          ...surface,
          // The board's own proportions, so the container's height follows its
          // width with nothing measuring anything.
          aspectRatio: `${BOARD_UNITS} / ${layout.contentHeight}`,
        }}
      >
        {layout.rows.map((row) => {
          const model = rowsById.get(row.rowId);
          return (
            <div key={row.rowId}>
              <div
                style={{
                  ...box(row.labelRect),
                  background: model?.color ?? BOARD_LINE,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: ROW_LABEL_TEXT,
                  fontWeight: 700,
                  fontSize: cqw(rowFontUnits(row.labelRect.width, row.rect.height)),
                  overflow: "hidden",
                }}
              >
                {model?.label ?? ""}
              </div>
              {row.tiles.map((t, i) => tile(t.itemId, `${t.itemId}:${i}`))}
            </div>
          );
        })}

        <div style={{ ...box(layout.tray.rect), background: BOARD_LINE }} />
        {layout.tray.tiles.map((t, i) => tile(t.itemId, `tray:${t.itemId}:${i}`))}
      </div>
    </div>
  );
}

/**
 * A tile's picture and its strokes, clipped to the tile.
 *
 * The image is positioned by exactly the arithmetic the Skia renderer uses:
 * `imagePlacement` says which source rectangle the tile shows, `imageDrawRect`
 * says where the *whole* image has to go for that rectangle to cover the tile,
 * and the tile's `overflow: hidden` is what Skia does with a clip group. The
 * `<img>` is stretched to that rect, so the browser performs the same
 * uniform-cover scale.
 */
function TileContent({
  item,
  rect,
  assetUrl,
  sources,
}: {
  item: Item;
  rect: Rect;
  assetUrl: (assetId: string) => string;
  sources: ReadonlyMap<string, { width: number; height: number }>;
}) {
  const dest: Rect = { x: 0, y: 0, width: rect.width, height: rect.height };

  return (
    <>
      {item.assetId && item.kind === "image" ? (
        <ImageLayer
          item={item}
          assetId={item.assetId}
          dest={dest}
          assetUrl={assetUrl}
          source={sources.get(item.assetId)}
        />
      ) : null}
      {/*
        Outside the image branch, matching `StrokeLayer` on the canvas: a text
        tile, or an image that never arrives, still owns whatever was drawn on
        it. Nesting the strokes inside the image's condition would leave
        strokes in the document painting nothing.
      */}
      <StrokeSvg item={item} dest={dest} />
    </>
  );
}

/**
 * A tile's picture, positioned by the same arithmetic the canvas uses.
 *
 * A plain `<img>` rather than `next/image`: the asset endpoint already serves
 * immutable, cache-forever bytes, and routing them through a second optimiser
 * costs a round trip on a page whose point is opening fast.
 */
function ImageLayer({
  item,
  assetId,
  dest,
  assetUrl,
  source,
}: {
  item: Item;
  assetId: string;
  dest: Rect;
  assetUrl: (assetId: string) => string;
  source: { width: number; height: number } | undefined;
}) {
  let draw: Rect | null = null;
  if (source && source.width > 0 && source.height > 0) {
    try {
      draw = imageDrawRect(imagePlacement(source, item.edit, dest), source);
    } catch {
      // `imagePlacement` refuses a rotation it cannot honour. A public page
      // showing the tile without its picture beats a server error for every
      // reader of the link.
      return null;
    }
  }

  if (!draw) {
    // No size for this asset — it was deleted, or the share response predates
    // the field. A centred cover is the honest degradation: it fills the tile
    // without distorting the image, and it is the framing the crop would have
    // had before the author touched it. Placing it by a guessed source size
    // would put the wrong part of the picture in the tile and look deliberate.
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={assetUrl(assetId)}
        alt={item.label ?? ""}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
      />
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={assetUrl(assetId)}
      alt={item.label ?? ""}
      style={{
        position: "absolute",
        left: pct(draw.x / dest.width),
        top: pct(draw.y / dest.height),
        width: pct(draw.width / dest.width),
        height: pct(draw.height / dest.height),
        maxWidth: "none",
      }}
    />
  );
}

/**
 * Committed strokes, in the tile's own coordinates.
 *
 * An inline SVG rather than a canvas: it is static, it scales with the tile for
 * free, and it costs no JavaScript. `toTilePoint` is the same mapping
 * `StrokeLayer` uses, so a stroke lands in the same place here as on the board.
 */
function StrokeSvg({ item, dest }: { item: Item; dest: Rect }) {
  if (item.edit.strokes.length === 0) return null;
  return (
    <svg
      viewBox={`0 0 ${dest.width} ${dest.height}`}
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
      aria-hidden="true"
    >
      {item.edit.strokes.map((stroke) => (
        <polyline
          key={stroke.id}
          points={strokePoints(stroke, dest, item.edit.crop)}
          fill="none"
          stroke={stroke.color}
          strokeWidth={strokeWidthInTile(stroke.width, dest, item.edit.crop)}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </svg>
  );
}

function strokePoints(stroke: Stroke, dest: Rect, crop: Item["edit"]["crop"]): string {
  // A zero-area crop makes `toTilePoint` throw. Dropping the stroke is the
  // same call `ImageLayer` makes for a rotation.
  if (!(crop.w > 0) || !(crop.h > 0)) return "";
  const out: string[] = [];
  for (let p = 0; p + 1 < stroke.points.length; p += 2) {
    const point = toTilePoint({ x: stroke.points[p]!, y: stroke.points[p + 1]! }, dest, crop);
    out.push(`${round(point.x)},${round(point.y)}`);
  }
  return out.join(" ");
}

function findRect(
  layout: ReturnType<typeof layoutBoard>,
  itemId: string,
): Rect | null {
  for (const row of layout.rows) {
    const found = row.tiles.find((t) => t.itemId === itemId);
    if (found) return found.rect;
  }
  return layout.tray.tiles.find((t) => t.itemId === itemId)?.rect ?? null;
}

/** Three decimals is under a thousandth of a percent — well past any screen. */
function pct(fraction: number): string {
  return `${round(fraction * 100)}%`;
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * Container-relative units: `1cqw` is one per cent of the container's inline
 * size, so type scales with the board exactly as the rest of it does. `vw`
 * would scale with the *window* and break the moment the board is not the full
 * width of it.
 */
function cqw(units: number): string {
  return `${round((units / BOARD_UNITS) * 100)}cqw`;
}

/**
 * Mirrors `tileFontSize` in @tl/editor's theme, in board units.
 *
 * Taken from the document's tile size rather than from the tile being drawn,
 * which is the same argument the canvas passes: one font size serves the whole
 * board there, so deriving it per tile here would make a row with a size
 * override render its labels at a size the canvas never uses.
 */
function tileFontUnits(tileWidth: number): number {
  return Math.max(9, Math.min(16, Math.round(tileWidth / 7)));
}

/** Mirrors `rowFontSize` in @tl/editor's theme, in board units. */
function rowFontUnits(labelWidth: number, rowHeight: number): number {
  return Math.max(12, Math.min(40, Math.round(Math.min(labelWidth / 3, rowHeight / 2.5))));
}

// Copied from @tl/editor/theme.ts rather than imported: that package pulls in
// react-native-skia, which must never be evaluated on a server-rendered page.
// Change both together.
const BOARD_BACKGROUND = "#14161a";
const BOARD_LINE = "#0b0d10";
const ROW_LABEL_TEXT = "#14161a";
const TILE_TEXT = "#e6e8ec";
const TILE_TEXT_FILL = "#242830";
const TILE_LOADING = "#3a3f47";

function tileStyle(item: Item): CSSProperties {
  return {
    background: item.kind === "image" ? TILE_LOADING : TILE_TEXT_FILL,
    overflow: "hidden",
  };
}

const container: CSSProperties = {
  width: "100%",
  // What makes `cqw` mean anything below. Without it those units resolve
  // against the nearest ancestor that *is* a container, or the viewport.
  containerType: "inline-size",
};

const surface: CSSProperties = {
  position: "relative",
  width: "100%",
  background: BOARD_BACKGROUND,
  borderRadius: 8,
  overflow: "hidden",
};

const tileLabel: CSSProperties = {
  position: "absolute",
  left: "4%",
  bottom: "3%",
  right: "4%",
  color: TILE_TEXT,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  textShadow: "0 1px 2px rgba(0,0,0,0.8)",
};
