import type { TierList, TierListAction } from "@tl/core";

export interface History {
  /** Snapshots of the document as it was *before* each recorded edit. */
  past: TierList[];
  /** Snapshots undone away, newest last, waiting to be redone. */
  future: TierList[];
  /** How many undo steps to keep. */
  limit: number;
  /**
   * The merge key of the last `record`, or null when the last thing that
   * happened was not a record at all.
   *
   * Coalescing is a property of two *consecutive* records, not of the entry
   * sitting on top of `past` — which is why this lives on the history rather
   * than on the entry. Undo and redo clear it, so an edit made after
   * navigating history always starts a fresh step. Without that, typing a
   * title, doing something else, undoing it and typing again would merge the
   * second burst into the first and the undo the user just performed would be
   * silently swallowed: one press of undo would jump two steps.
   */
  pendingMergeKey: string | null;
}

export interface HistoryStep {
  history: History;
  doc: TierList;
}

export function createHistory(limit = 100): History {
  return { past: [], future: [], limit, pendingMergeKey: null };
}

export function canUndo(history: History): boolean {
  return history.past.length > 0;
}

export function canRedo(history: History): boolean {
  return history.future.length > 0;
}

/**
 * Content moves backwards; `revision` and `updatedAt` move forwards.
 *
 * Restoring a snapshot verbatim would let one revision number name two
 * different documents. The API updates a row only where
 * `revision = expectedRevision` (services/api/src/repository.ts), so a second
 * device still holding the earlier revision could PATCH straight over this
 * one and the server would accept it — losing the write with no conflict
 * reported. Undo therefore looks like every other edit: a new revision.
 *
 * Everything else comes from the snapshot, including `id`, `createdAt`,
 * `schemaVersion` and `templateId`. That is sound because no action can change
 * them: `meta/set` is the only action that writes top-level fields at all, and
 * its patch type admits only `title`, `description`, `categoryId` and `tags`.
 * So for any document reachable from the snapshot by reducing actions, those
 * fields are identical in both, and copying either is the same thing.
 */
function restore(snapshot: TierList, current: TierList, now: string): TierList {
  return { ...snapshot, revision: current.revision + 1, updatedAt: now };
}

/**
 * Push the document as it was *before* an edit.
 *
 * Call this only when the edit actually changed something. `record` cannot
 * check that itself — it never sees the result — so the check belongs to the
 * caller, where @tl/core makes it a single comparison: `reduce()` returns the
 * same object reference for a no-op, so the shape is
 *
 *     const next = reduce(doc, action, now);
 *     if (next === doc) return;
 *     history = record(history, doc, mergeKeyFor(action));
 *     doc = next;
 *
 * Recording a no-op would put a step on the stack that restores the state it
 * is already in — an undo button that visibly does nothing.
 */
export function record(
  history: History,
  before: TierList,
  mergeKey: string | null = null,
): History {
  // The previous record carried the same key, so this edit continues that
  // step: the snapshot already on the stack is the right restore point and
  // this one is not needed. Typing a title becomes one undo step rather than
  // one per keystroke.
  //
  // Nothing else needs doing. `future` is necessarily already empty, because a
  // pending key can only have been left by a record and every record clears it.
  if (mergeKey !== null && mergeKey === history.pendingMergeKey) return history;

  const past = [...history.past, before];
  return {
    past:
      past.length > history.limit ? past.slice(past.length - history.limit) : past,
    // A new edit after an undo abandons the branch that was undone.
    future: [],
    limit: history.limit,
    pendingMergeKey: mergeKey,
  };
}

export function undo(
  history: History,
  current: TierList,
  now: string,
): HistoryStep | null {
  const snapshot = history.past[history.past.length - 1];
  if (!snapshot) return null;

  return {
    history: {
      past: history.past.slice(0, -1),
      future: [...history.future, current],
      limit: history.limit,
      // Navigating history ends any run of coalescing edits.
      pendingMergeKey: null,
    },
    doc: restore(snapshot, current, now),
  };
}

export function redo(
  history: History,
  current: TierList,
  now: string,
): HistoryStep | null {
  const snapshot = history.future[history.future.length - 1];
  if (!snapshot) return null;

  return {
    history: {
      past: [...history.past, current],
      future: history.future.slice(0, -1),
      limit: history.limit,
      pendingMergeKey: null,
    },
    doc: restore(snapshot, current, now),
  };
}

/**
 * Fields a user edits *continuously* — a title typed one character at a time,
 * a width dragged on a slider. Only these coalesce.
 *
 * Everything else is a discrete choice: a category picked, a tag added, a
 * switch flipped. Merging two discrete choices loses one of them, and merging
 * a choice with its own reversal (a switch flipped off and back on) leaves a
 * step that restores the state the document is already in — the undo button
 * that does nothing again.
 */
const CONTINUOUS_META: ReadonlySet<string> = new Set(["title", "description"]);
const CONTINUOUS_DISPLAY: ReadonlySet<string> = new Set([
  "tileSize",
  "labelWidth",
]);

function patchKey(
  prefix: string,
  patch: object,
  continuous: ReadonlySet<string>,
): string | null {
  const keys = Object.keys(patch);
  // An empty patch changes nothing, so it belongs to no step. (@tl/core still
  // treats it as an edit and bumps the revision — that is the reducer's
  // business, and coalescing empties would only hide it.)
  if (keys.length === 0) return null;
  // One discrete field is enough to make the whole patch a discrete edit.
  if (!keys.every((key) => continuous.has(key))) return null;
  // Keyed on the whole field set, sorted, so a form that writes title and
  // description together still coalesces with itself regardless of the order
  // it built the patch in, while never merging with a differently shaped one.
  return `${prefix}/${keys.sort().join(",")}`;
}

/**
 * The undo step an action belongs to, or null when it deserves its own.
 *
 * Structural edits — adding an item, moving a tile, removing a row — are
 * discrete user intentions, and collapsing two of them into one undo would
 * lose work the user expected to get back.
 *
 * `item/setEdit` and `row/recolor` are unkeyed even though a crop handle and a
 * colour wheel are dragged continuously, because neither action says *which*
 * part of the value moved — `item/setEdit` replaces a whole `ImageEdit`,
 * strokes included, and merging a run of freehand strokes into one undo step
 * would be wrong. Those gestures coalesce where the drag machine does, by
 * emitting one action when the gesture ends rather than one per frame.
 */
export function mergeKeyFor(action: TierListAction): string | null {
  switch (action.type) {
    case "meta/set":
      return patchKey("meta", action.patch, CONTINUOUS_META);
    case "display/set":
      return patchKey("display", action.patch, CONTINUOUS_DISPLAY);
    case "row/rename":
      return `row/rename:${action.rowId}`;
    default:
      return null;
  }
}
