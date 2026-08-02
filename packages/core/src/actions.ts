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
  | { type: "row/reorder"; rowId: string; toIndex: number }
  | { type: "item/addText"; id: string; label: string }
  | {
      type: "item/addImage";
      id: string;
      assetId: string;
      label?: string;
      /**
       * The crop to store, computed by the caller (usually aspect-locked to
       * the tile via `defaultCropFor`/`aspectRatioFor` in `@tl/editor-core`).
       * Omitted when the caller has no source size to compute one from —
       * `defaultImageEdit()` then supplies a full-frame fallback so the
       * document is still valid, just uncropped.
       *
       * `@tl/core` deliberately does not compute this itself: doing so would
       * mean importing tile geometry from `@tl/editor-core`, and this package
       * stays the pure document model with no knowledge of tiles.
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
  | {
      type: "meta/set";
      patch: Partial<
        Pick<TierList, "title" | "description" | "categoryId" | "tags">
      >;
    };
