import type { DisplaySettings, ImageEdit, TierList } from "./types";

/**
 * Every action that creates an entity carries the new id. The reducer never
 * generates ids and never reads the clock — callers supply both — so that
 * every reduction is deterministic and testable without mocks.
 */
export type TierListAction =
  | { type: "row/add"; id: string; label: string; color: string }
  | { type: "row/rename"; rowId: string; label: string }
  | { type: "row/recolor"; rowId: string; color: string }
  | { type: "row/remove"; rowId: string }
  /**
   * Per-row tile size. `null` clears the override, returning the row to
   * `display.tileSize` — a value of this action rather than a separate
   * `row/clearTileSize`, so a control that both sets and clears emits one
   * action and the reducer keeps one branch correct.
   */
  | { type: "row/setTileSize"; rowId: string; tileSize: number | null }
  /** Whether this tier's label is drawn bold. */
  | { type: "row/setBold"; rowId: string; bold: boolean }
  | { type: "row/reorder"; rowId: string; toIndex: number }
  | { type: "item/addText"; id: string; label: string }
  | {
      type: "item/addImage";
      id: string;
      assetId: string;
      label?: string;
      /**
       * The crop to store, computed by the caller — usually aspect-locked to
       * the tile via `defaultCropFor`/`aspectRatioFor` in `@tl/editor-core`.
       * Omitted when the caller has no source size to compute one from, and
       * `defaultImageEdit()` then supplies a full-frame fallback so the
       * document is valid, just uncropped.
       *
       * This package does not compute it: doing so would mean importing tile
       * geometry, and the document model knows nothing about tiles.
       */
      edit?: ImageEdit;
    }
  | { type: "item/remove"; itemId: string }
  | { type: "item/setEdit"; itemId: string; edit: ImageEdit }
  // `null` targets the tray. The tray is an ordered location like any row, so
  // an item can be dropped at a chosen position in it rather than only appended.
  | {
      type: "placement/place";
      itemId: string;
      rowId: string | null;
      index: number;
    }
  | { type: "placement/unplace"; itemId: string }
  | { type: "display/set"; patch: Partial<DisplaySettings> }
  /**
   * Set the list-wide tile size *and* drop every per-row override, so every
   * tier ends up the same size.
   *
   * One action rather than a `display/set` followed by a clear per row,
   * because those are one user intention: a run of them would be a run of undo
   * steps, revisions and saves for a single drag of a single control. The
   * override is removed rather than rewritten to the new value — a row with no
   * override *follows* the list-wide size, so equal tiers stay equal when the
   * list-wide size next changes.
   */
  | { type: "display/setUniformTileSize"; tileSize: number }
  | {
      type: "meta/set";
      patch: Partial<
        Pick<TierList, "title" | "description" | "categoryId" | "tags">
      >;
    };
