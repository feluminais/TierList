import type { TierListAction } from "./actions";
import { defaultImageEdit } from "./factory";
import type { Item, Placement, Row, TierList } from "./types";

function renumber(rows: Row[]): Row[] {
  return rows.map((r, i) => ({ ...r, order: i }));
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}

function apply(doc: TierList, action: TierListAction): TierList {
  switch (action.type) {
    case "row/add": {
      const row: Row = {
        id: action.id,
        label: action.label,
        color: action.color,
        order: doc.rows.length,
      };
      return { ...doc, rows: [...doc.rows, row] };
    }

    case "row/rename": {
      if (!doc.rows.some((r) => r.id === action.rowId)) return doc;
      return {
        ...doc,
        rows: doc.rows.map((r) =>
          r.id === action.rowId ? { ...r, label: action.label } : r,
        ),
      };
    }

    case "row/recolor": {
      if (!doc.rows.some((r) => r.id === action.rowId)) return doc;
      return {
        ...doc,
        rows: doc.rows.map((r) =>
          r.id === action.rowId ? { ...r, color: action.color } : r,
        ),
      };
    }

    case "row/remove": {
      if (!doc.rows.some((r) => r.id === action.rowId)) return doc;
      return {
        ...doc,
        rows: renumber(doc.rows.filter((r) => r.id !== action.rowId)),
        placements: doc.placements.map((p) =>
          p.rowId === action.rowId ? { ...p, rowId: null, index: 0 } : p,
        ),
      };
    }

    case "row/reorder": {
      const from = doc.rows.findIndex((r) => r.id === action.rowId);
      if (from === -1) return doc;
      const rows = [...doc.rows];
      const [moved] = rows.splice(from, 1);
      if (!moved) return doc;
      rows.splice(clamp(action.toIndex, 0, rows.length), 0, moved);
      return { ...doc, rows: renumber(rows) };
    }

    case "item/addText": {
      const item: Item = {
        id: action.id,
        kind: "text",
        label: action.label,
        edit: defaultImageEdit(),
        order: doc.items.length,
      };
      const placement: Placement = { itemId: action.id, rowId: null, index: 0 };
      return {
        ...doc,
        items: [...doc.items, item],
        placements: [...doc.placements, placement],
      };
    }

    case "item/addImage": {
      const item: Item = {
        id: action.id,
        kind: "image",
        label: action.label,
        assetId: action.assetId,
        edit: defaultImageEdit(),
        order: doc.items.length,
      };
      const placement: Placement = { itemId: action.id, rowId: null, index: 0 };
      return {
        ...doc,
        items: [...doc.items, item],
        placements: [...doc.placements, placement],
      };
    }

    case "item/remove": {
      if (!doc.items.some((i) => i.id === action.itemId)) return doc;
      return {
        ...doc,
        items: doc.items
          .filter((i) => i.id !== action.itemId)
          .map((i, idx) => ({ ...i, order: idx })),
        placements: doc.placements.filter((p) => p.itemId !== action.itemId),
      };
    }

    case "item/setEdit": {
      if (!doc.items.some((i) => i.id === action.itemId)) return doc;
      return {
        ...doc,
        items: doc.items.map((i) =>
          i.id === action.itemId ? { ...i, edit: action.edit } : i,
        ),
      };
    }

    case "placement/place": {
      const others = doc.placements.filter((p) => p.itemId !== action.itemId);
      const inRow = others
        .filter((p) => p.rowId === action.rowId)
        .sort((a, b) => a.index - b.index);
      const target = clamp(action.index, 0, inRow.length);
      inRow.splice(target, 0, {
        itemId: action.itemId,
        rowId: action.rowId,
        index: target,
      });
      const renumbered = inRow.map((p, i) => ({ ...p, index: i }));
      const untouched = others.filter((p) => p.rowId !== action.rowId);
      return { ...doc, placements: [...untouched, ...renumbered] };
    }

    case "placement/unplace": {
      const current = doc.placements.find((p) => p.itemId === action.itemId);
      if (!current) return doc;
      const others = doc.placements.filter((p) => p.itemId !== action.itemId);
      const resettled = others.map((p) =>
        p.rowId === current.rowId && p.index > current.index
          ? { ...p, index: p.index - 1 }
          : p,
      );
      return {
        ...doc,
        placements: [
          ...resettled,
          { itemId: action.itemId, rowId: null, index: 0 },
        ],
      };
    }

    case "display/set":
      return { ...doc, display: { ...doc.display, ...action.patch } };

    case "meta/set":
      return { ...doc, ...action.patch };
  }
}

/**
 * The single place a tier list document mutates.
 * Pure: same inputs always produce the same output.
 */
export function reduce(
  doc: TierList,
  action: TierListAction,
  now: string,
): TierList {
  const next = apply(doc, action);
  if (next === doc) return doc;
  return { ...next, updatedAt: now, revision: doc.revision + 1 };
}
