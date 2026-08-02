import type { TierListAction } from "./actions";
import { defaultImageEdit } from "./factory";
import type { Item, Placement, Row, TierList } from "./types";

function renumber(rows: Row[]): Row[] {
  return rows.map((r, i) => ({ ...r, order: i }));
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}

function trayCount(placements: Placement[]): number {
  return placements.filter((p) => p.rowId === null).length;
}

/**
 * Close the hole a placement left behind, so indices stay contiguous within
 * its location. `placements` must already exclude the vacated placement.
 */
function closeGap(placements: Placement[], vacated: Placement): Placement[] {
  return placements.map((p) =>
    p.rowId === vacated.rowId && p.index > vacated.index
      ? { ...p, index: p.index - 1 }
      : p,
  );
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
      const kept = doc.placements.filter((p) => p.rowId !== action.rowId);
      // The row's items go to the end of the tray in the order they held —
      // the destination `placement/unplace` uses — numbered from the tray's
      // current length so its indices stay contiguous. Not `closeGap`, which
      // closes a single hole in place: removing a row empties one location
      // outright and renumbers its items into a different one.
      const trayBase = trayCount(kept);
      const returned = doc.placements
        .filter((p) => p.rowId === action.rowId)
        .sort((a, b) => a.index - b.index)
        .map((p, i) => ({ ...p, rowId: null, index: trayBase + i }));
      return {
        ...doc,
        rows: renumber(doc.rows.filter((r) => r.id !== action.rowId)),
        placements: [...kept, ...returned],
      };
    }

    case "row/setTileSize": {
      const row = doc.rows.find((r) => r.id === action.rowId);
      if (!row) return doc;
      // Setting the size a row already has — which a slider does on every
      // frame it is dragged without crossing a step boundary — is a no-op, so
      // the same reference goes back and `reduce()` skips the revision bump
      // and the save it would trigger. `?? null` on the left because an absent
      // override and an explicit null are the same state.
      if ((row.tileSizeOverride ?? null) === action.tileSize) return doc;

      return {
        ...doc,
        rows: doc.rows.map((r) => {
          if (r.id !== action.rowId) return r;
          if (action.tileSize === null) {
            // The key is deleted rather than set to undefined. The document is
            // stored as JSON, where `{tileSizeOverride: undefined}` and `{}`
            // round-trip to the same thing, so leaving the key in place makes
            // a cleared row compare unequal to a row that never had an
            // override — in memory, but not after a reload.
            const { tileSizeOverride: _cleared, ...rest } = r;
            return rest;
          }
          return { ...r, tileSizeOverride: action.tileSize };
        }),
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
      const placement: Placement = {
        itemId: action.id,
        rowId: null,
        index: trayCount(doc.placements),
      };
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
        edit: action.edit ?? defaultImageEdit(),
        order: doc.items.length,
      };
      const placement: Placement = {
        itemId: action.id,
        rowId: null,
        index: trayCount(doc.placements),
      };
      return {
        ...doc,
        items: [...doc.items, item],
        placements: [...doc.placements, placement],
      };
    }

    case "item/remove": {
      if (!doc.items.some((i) => i.id === action.itemId)) return doc;
      const vacated = doc.placements.find((p) => p.itemId === action.itemId);
      const remaining = doc.placements.filter((p) => p.itemId !== action.itemId);
      return {
        ...doc,
        items: doc.items
          .filter((i) => i.id !== action.itemId)
          .map((i, idx) => ({ ...i, order: idx })),
        // `vacated` is undefined only for an item with no placement, which a
        // valid document does not contain — there is then no hole to close.
        placements: vacated ? closeGap(remaining, vacated) : remaining,
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
      const current = doc.placements.find((p) => p.itemId === action.itemId);
      const others = doc.placements.filter((p) => p.itemId !== action.itemId);

      // Close the gap the item leaves behind, so indices stay contiguous
      // within every location. Skipped when the item is not changing location,
      // to save the work: every index `closeGap` would touch is then in the
      // target set, which the renumber below overwrites wholesale.
      const remaining =
        current && current.rowId !== action.rowId
          ? closeGap(others, current)
          : others;

      const inTarget = remaining
        .filter((p) => p.rowId === action.rowId)
        .sort((a, b) => a.index - b.index);
      const target = clamp(action.index, 0, inTarget.length);

      // Already exactly there: a no-op, so return the same reference and let
      // reduce() skip the revision bump. Compared after clamping, because an
      // out-of-range index names the same slot as the last one.
      const alreadyThere =
        current !== undefined &&
        current.rowId === action.rowId &&
        current.index === target;
      if (alreadyThere) return doc;

      inTarget.splice(target, 0, {
        itemId: action.itemId,
        rowId: action.rowId,
        index: target,
      });
      const renumbered = inTarget.map((p, i) => ({ ...p, index: i }));
      const untouched = remaining.filter((p) => p.rowId !== action.rowId);
      return { ...doc, placements: [...untouched, ...renumbered] };
    }

    case "placement/unplace": {
      const current = doc.placements.find((p) => p.itemId === action.itemId);
      if (!current) return doc;
      // Already in the tray: a no-op, so the same reference goes back.
      if (current.rowId === null) return doc;

      const others = doc.placements.filter((p) => p.itemId !== action.itemId);
      const resettled = closeGap(others, current);
      return {
        ...doc,
        placements: [
          ...resettled,
          // The end of the tray, not the front: returning an item to where the
          // eye last saw the tray grow is less surprising than shunting every
          // other tray item along.
          { itemId: action.itemId, rowId: null, index: trayCount(others) },
        ],
      };
    }

    case "display/set":
      return { ...doc, display: { ...doc.display, ...action.patch } };

    case "display/setUniformTileSize": {
      const hasOverride = doc.rows.some((r) => r.tileSizeOverride !== undefined);
      // Nothing to do: the size already holds and no row departs from it. A
      // slider dragged within one step lands here on most frames, and
      // returning the same reference is what stops each one becoming a
      // revision, an autosave and an undo step.
      if (doc.display.tileSize === action.tileSize && !hasOverride) return doc;

      return {
        ...doc,
        display: { ...doc.display, tileSize: action.tileSize },
        rows: doc.rows.map((row) => {
          if (row.tileSizeOverride === undefined) return row;
          // Deleted rather than set to undefined, for the reason
          // `row/setTileSize` documents: the document is stored as JSON, where
          // an undefined-valued key and an absent one are the same thing.
          const { tileSizeOverride: _cleared, ...rest } = row;
          return rest;
        }),
      };
    }

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
