import {
  DOCUMENT_LIMITS,
  reduce,
  sameDocument,
  type TierList,
  type TierListAction,
} from "@tl/core";
import {
  canRedo,
  canUndo,
  createHistory,
  mergeKeyFor,
  record,
  redo,
  undo,
  type History,
} from "./history";

export type SaveStatus = "saved" | "dirty" | "saving" | "conflict" | "error";

export type SaveFailure = "conflict" | "offline";

export interface EditorSession {
  doc: TierList;
  history: History;
  /**
   * The revision the server has acknowledged holding, or null when it has
   * never seen this document.
   *
   * A boolean dirty flag cannot answer "did the user edit while a save was in
   * flight" — this can, and it is the same number the API already matches on.
   */
  syncedRevision: number | null;
  status: SaveStatus;
  canUndo: boolean;
  canRedo: boolean;
}

/** What the transport should do next, or null when it should do nothing. */
export type PendingWrite =
  | { kind: "create"; doc: TierList }
  | { kind: "update"; doc: TierList; expectedRevision: number };

/**
 * The single constructor for a session, so `canUndo`/`canRedo` cannot drift
 * from the history they describe.
 *
 * They are stored rather than exposed as functions because their only consumer
 * is a `disabled` prop, and a component should not have to call anything to
 * know whether to grey a button out. Storing them is safe exactly because
 * nothing else in this module builds an `EditorSession` literal.
 */
function derive(
  doc: TierList,
  history: History,
  syncedRevision: number | null,
  status: SaveStatus,
): EditorSession {
  return {
    doc,
    history,
    syncedRevision,
    status,
    canUndo: canUndo(history),
    canRedo: canRedo(history),
  };
}

export function createSession(
  doc: TierList,
  syncedRevision: number | null,
): EditorSession {
  return derive(
    doc,
    createHistory(),
    syncedRevision,
    syncedRevision === doc.revision ? "saved" : "dirty",
  );
}

/**
 * A save is worth attempting when the document has moved past what the server
 * acknowledged — and only then.
 *
 * `saving` returns null so two writes cannot race for the same
 * `expectedRevision`; the second would 409 against the first. `conflict`
 * returns null because another writer reached the server first, and retrying
 * with a stale expectation either fails forever or, worse, succeeds after the
 * user's next edit and silently discards theirs. Recovery needs a decision
 * this module cannot make alone.
 */
export function pendingWrite(session: EditorSession): PendingWrite | null {
  if (session.status === "saving" || session.status === "conflict") return null;
  if (session.syncedRevision === null) {
    return { kind: "create", doc: session.doc };
  }
  if (session.syncedRevision === session.doc.revision) return null;
  return {
    kind: "update",
    doc: session.doc,
    expectedRevision: session.syncedRevision,
  };
}

/**
 * Edits the server has not acknowledged, in the form a device keeps them
 * between visits — so closing the tab, losing the network or a crash cannot
 * take them away.
 */
export interface Draft {
  doc: TierList;
  /**
   * The server revision these edits were made on top of, or null when the
   * server had never held the list. Resuming is only safe while the server is
   * still there.
   */
  baseRevision: number | null;
}

/**
 * The draft this session needs kept, or null when the server holds everything.
 *
 * A list the server has never held needs no draft until it has been edited: an
 * untouched new list is recreated as it is, and keeping one would later turn
 * into an empty "recovered" copy of a list the device merely opened offline.
 */
export function unsyncedDraft(session: EditorSession): Draft | null {
  const base = session.syncedRevision;
  if (session.doc.revision <= (base ?? 0)) return null;
  return { doc: session.doc, baseRevision: base };
}

export interface Resumed {
  session: EditorSession;
  /**
   * Unsaved edits that no longer fit the list as the server holds it, as a new
   * list the caller should create — or null when there is nothing to recover.
   */
  recovered: TierList | null;
}

const RECOVERED_SUFFIX = " (recovered)";

/**
 * Open a list from what the server holds and what this device kept.
 *
 * - No draft: the stored list, or `fresh` when the server has none.
 * - A draft made on top of exactly what the server holds — or a list the
 *   server does not have — picks up where it left off, unsaved and ready for
 *   autosave to send.
 * - A draft whose edits already reached the server (only the response went
 *   missing) is simply the stored list.
 * - Otherwise the list moved on without these edits, on another device.
 *   Neither version may silently replace the other, so the stored list opens as
 *   it is and the draft becomes a separate list, `recovered`, under `fork.id`.
 *
 * `fresh` is also what identifies the list: a draft for any other id is ignored.
 */
export function resumeSession(
  stored: TierList | null,
  draft: Draft | null,
  fresh: TierList,
  fork: { id: string; now: string },
): Resumed {
  const fromServer = stored ? createSession(stored, stored.revision) : createSession(fresh, null);
  if (!draft || draft.doc.id !== fresh.id) return { session: fromServer, recovered: null };

  if (stored === null) return { session: createSession(draft.doc, null), recovered: null };
  if (draft.baseRevision === stored.revision) {
    return { session: createSession(draft.doc, stored.revision), recovered: null };
  }
  if (sameDocument(stored, draft.doc)) return { session: fromServer, recovered: null };

  const title = (draft.doc.title || "Untitled tier list").slice(
    0,
    DOCUMENT_LIMITS.titleLength - RECOVERED_SUFFIX.length,
  );
  return {
    session: fromServer,
    recovered: {
      ...draft.doc,
      id: fork.id,
      title: `${title}${RECOVERED_SUFFIX}`,
      revision: 0,
      createdAt: fork.now,
      updatedAt: fork.now,
    },
  };
}

/**
 * Apply an edit, recording it so it can be undone.
 *
 * Returns the *same session object* for a no-op, mirroring `reduce()`'s own
 * contract. That is what stops a no-op putting an undo step on the stack that
 * restores the state it is already in — an undo button that visibly does
 * nothing — and it lets callers skip a re-render with a reference check.
 */
export function applyAction(
  session: EditorSession,
  action: TierListAction,
  now: string,
): EditorSession {
  const next = reduce(session.doc, action, now);
  if (next === session.doc) return session;

  return derive(
    next,
    record(session.history, session.doc, mergeKeyFor(action)),
    session.syncedRevision,
    editedStatus(session.status),
  );
}

/**
 * Apply several actions as **one** edit.
 *
 * Exists because some single gestures move two things at once. Dragging a
 * tier's corner changes that tier's tile size *and* the width of the label
 * column, and those are two actions because they are two different settings —
 * but they are one thing the user did, and `applyAction` twice would put two
 * steps on the undo stack for one drag.
 *
 * The batch's merge key is its actions' keys joined, so a run of identical
 * batches — every frame of that drag — coalesces into a single step exactly as
 * a run of one continuous action does. A batch containing anything discrete
 * (its own key is null) is not merged at all, for the reason `mergeKeyFor`
 * gives: merging two discrete choices loses one of them.
 *
 * Returns the same session when *nothing* changed, mirroring `applyAction`.
 * Actions that individually no-op are simply skipped; a batch is not all-or-
 * nothing, because the axis of a resize that has already hit its clamp should
 * not stop the other axis from moving.
 */
export function applyActions(
  session: EditorSession,
  actions: readonly TierListAction[],
  now: string,
): EditorSession {
  let doc = session.doc;
  for (const action of actions) doc = reduce(doc, action, now);
  if (doc === session.doc) return session;

  const keys = actions.map(mergeKeyFor);
  const mergeKey = keys.every((key) => key !== null) ? keys.join("|") : null;

  return derive(
    doc,
    record(session.history, session.doc, mergeKey),
    session.syncedRevision,
    editedStatus(session.status),
  );
}

/**
 * What an edit does to the save status.
 *
 * A save in flight keeps its status: the write already sent is still
 * outstanding, and `saveSucceeded` will notice the document has moved on. A
 * conflicted session stays conflicted — nothing here can clear a conflict, and
 * pretending an edit did would restart the save loop straight into clobbering
 * the other writer. Everything else goes dirty.
 *
 * Shared by `applyAction`, `undoSession` and `redoSession` because undo and
 * redo are edits like any other: they move content and bump the revision.
 */
function editedStatus(status: SaveStatus): SaveStatus {
  if (status === "saving") return "saving";
  if (status === "conflict") return "conflict";
  return "dirty";
}

export function undoSession(session: EditorSession, now: string): EditorSession {
  const step = undo(session.history, session.doc, now);
  if (!step) return session;
  return derive(
    step.doc,
    step.history,
    session.syncedRevision,
    editedStatus(session.status),
  );
}

export function redoSession(session: EditorSession, now: string): EditorSession {
  const step = redo(session.history, session.doc, now);
  if (!step) return session;
  return derive(
    step.doc,
    step.history,
    session.syncedRevision,
    editedStatus(session.status),
  );
}

/**
 * The transport has sent a write and is waiting on it.
 *
 * The status this sets is cleared only by `saveSucceeded` or `saveFailed`, so a
 * transport that starts a write and then drops its result leaves the session
 * saving forever and `pendingWrite` null forever. Reporting every outcome is
 * part of the contract, not a nicety.
 */
export function saveStarted(session: EditorSession): EditorSession {
  return derive(session.doc, session.history, session.syncedRevision, "saving");
}

/**
 * `acknowledged` is the revision the server confirmed, which is the one that
 * was *sent* — not necessarily the one the document holds now. An edit made
 * while the write was in flight leaves the session dirty again, which is
 * exactly right and is why this takes the number rather than assuming it.
 */
export function saveSucceeded(
  session: EditorSession,
  acknowledged: number,
): EditorSession {
  return derive(
    session.doc,
    session.history,
    acknowledged,
    acknowledged === session.doc.revision ? "saved" : "dirty",
  );
}

export function saveFailed(
  session: EditorSession,
  failure: SaveFailure,
): EditorSession {
  return derive(
    session.doc,
    session.history,
    session.syncedRevision,
    failure === "conflict" ? "conflict" : "error",
  );
}
