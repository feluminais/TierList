"use client";

import { migrate, validateDocument, type TierList } from "@tl/core";
import { unsyncedDraft, type Draft, type EditorSession } from "@tl/editor-core";
import { useEffect } from "react";

/**
 * Where a device keeps drafts: `localStorage` on the web, AsyncStorage on a
 * phone. Reads and writes may be synchronous or asynchronous, so one hook
 * serves both without either pretending to be the other.
 */
export interface DraftStore {
  getItem: (key: string) => string | null | Promise<string | null>;
  setItem: (key: string, value: string) => void | Promise<void>;
  removeItem: (key: string) => void | Promise<void>;
}

export function draftKey(listId: string): string {
  return `tl.draft.${listId}`;
}

/**
 * The draft this device kept for a list, or null when there is none it can
 * trust.
 *
 * A stored draft is untrusted input like any other: it may predate the
 * current schema, or have been cut short by a full disk. It goes through the
 * same `migrate` and `validateDocument` as a document arriving over the network,
 * and anything that fails is treated as no draft rather than as an error the
 * user can do nothing about.
 */
export async function readDraft(store: DraftStore | null, listId: string): Promise<Draft | null> {
  if (!store) return null;
  try {
    const text = await store.getItem(draftKey(listId));
    if (!text) return null;

    const raw = JSON.parse(text) as { doc?: unknown; baseRevision?: unknown };
    const doc = migrate(raw.doc);
    if (validateDocument(doc).length > 0) return null;

    const base = raw.baseRevision;
    const baseRevision =
      base === null
        ? null
        : typeof base === "number" && Number.isInteger(base) && base >= 0
          ? base
          : undefined;
    if (baseRevision === undefined) return null;
    return { doc: doc as TierList, baseRevision };
  } catch {
    return null;
  }
}

/** Forget a list's draft. Failure is ignored: a stale draft is resolved on the next load. */
export async function removeDraft(store: DraftStore | null, listId: string): Promise<void> {
  if (!store) return;
  try {
    await store.removeItem(draftKey(listId));
  } catch {
    // Nothing to do — see above.
  }
}

/**
 * Keep this device's copy of any edits the server has not acknowledged, and
 * drop it once the server has them.
 *
 * Gated on `loaded`: until the stored list and any draft have been read, the
 * session holds a placeholder, and writing that would overwrite the very draft
 * the load is about to look for.
 *
 * A write that fails — storage full or blocked — is ignored. The draft is a
 * safety net under autosave, not a second source of truth, and a failure to
 * keep one must not interrupt editing.
 */
export function useDraft(
  listId: string,
  session: EditorSession,
  loaded: boolean,
  store: DraftStore | null,
): void {
  useEffect(() => {
    if (!loaded || !store) return;
    const draft = unsyncedDraft(session);
    const key = draftKey(listId);

    Promise.resolve()
      .then(() => (draft ? store.setItem(key, JSON.stringify(draft)) : store.removeItem(key)))
      .catch(() => {});

    // Keyed on what decides the draft: a document edit, or the server
    // acknowledging a revision. Status changes alone decide nothing here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listId, session.doc, session.syncedRevision, loaded, store]);
}
