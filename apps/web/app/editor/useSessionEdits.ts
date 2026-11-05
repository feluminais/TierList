"use client";

import type { TierListAction } from "@tl/core";
import {
  applyAction,
  applyActions,
  redoSession,
  undoSession,
  type EditorSession,
} from "@tl/editor-core";
import { useCallback, type Dispatch, type SetStateAction } from "react";

export interface SessionEdits {
  dispatch: (action: TierListAction) => void;
  /** Several actions as one edit: one undo step, one revision. */
  dispatchAll: (actions: readonly TierListAction[]) => void;
  undo: () => void;
  redo: () => void;
}

/**
 * Every way the editor changes its session, in one place, and every one of them
 * a no-op until the list has loaded.
 *
 * Until then the session is a placeholder for a document that has not arrived,
 * and the load replaces it wholesale. An edit made to the placeholder would be
 * shown, then vanish when the real document landed — and the draft written from
 * it could be mistaken for the user's own work.
 *
 * The clock is passed in so the reducer stays free of it. `applyAction` returns
 * the same session for an edit that changes nothing, so React bails out and the
 * autosave debounce is not restarted by it.
 */
export function useSessionEdits(
  setSession: Dispatch<SetStateAction<EditorSession>>,
  loaded: boolean,
  clock: () => string,
): SessionEdits {
  const dispatch = useCallback(
    (action: TierListAction) => {
      if (!loaded) return;
      setSession((current) => applyAction(current, action, clock()));
    },
    [setSession, loaded, clock],
  );

  const dispatchAll = useCallback(
    (actions: readonly TierListAction[]) => {
      if (!loaded) return;
      setSession((current) => applyActions(current, actions, clock()));
    },
    [setSession, loaded, clock],
  );

  const undo = useCallback(() => {
    if (!loaded) return;
    setSession((current) => undoSession(current, clock()));
  }, [setSession, loaded, clock]);

  const redo = useCallback(() => {
    if (!loaded) return;
    setSession((current) => redoSession(current, clock()));
  }, [setSession, loaded, clock]);

  return { dispatch, dispatchAll, undo, redo };
}
