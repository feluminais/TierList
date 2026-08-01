import { reduce, type TierList, type TierListAction } from "@tl/core";
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
