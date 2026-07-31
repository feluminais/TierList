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
  | { type: "item/addImage"; id: string; assetId: string; label?: string }
  | { type: "item/remove"; itemId: string }
  | { type: "item/setEdit"; itemId: string; edit: ImageEdit }
  | { type: "placement/place"; itemId: string; rowId: string; index: number }
  | { type: "placement/unplace"; itemId: string }
  | { type: "display/set"; patch: Partial<DisplaySettings> }
  | {
      type: "meta/set";
      patch: Partial<
        Pick<TierList, "title" | "description" | "categoryId" | "tags">
      >;
    };
