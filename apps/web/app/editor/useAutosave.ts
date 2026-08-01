"use client";

import { ApiError, type Client } from "@tl/api-client";
import { pendingWrite, type EditorSession } from "@tl/editor-core";
import { useEffect, useRef } from "react";

/** How long the document must sit still before a save is attempted. */
export const AUTOSAVE_DEBOUNCE_MS = 800;

/**
 * How long to wait before retrying after a *transient* failure.
 *
 * Without this the loop is `debounce -> request -> fail -> debounce -> ...`,
 * which against a dead network or a 500 is roughly one request per second for
 * as long as the tab is open. A conflict does not retry at all — `pendingWrite`
 * returns null for it — so this only ever governs failures that are worth
 * repeating.
 */
export const AUTOSAVE_RETRY_MS = 5000;

export interface AutosaveHandlers {
  onSaveStarted: () => void;
  onSaveSucceeded: (acknowledged: number) => void;
  onSaveFailed: (failure: "conflict" | "offline") => void;
}

/** Injected only so tests need not wait a real second per assertion. */
export interface AutosaveTimings {
  debounceMs?: number;
  retryMs?: number;
}

/**
 * Drives the session's save policy over the network.
 *
 * The policy itself — whether to write, whether it is a create or an update,
 * and which revision to expect — is decided by `pendingWrite` in
 * `@tl/editor-core`, where it is pure and tested. This supplies only the
 * debounce, the clock and the transport.
 *
 * A drag already emits exactly one action, one revision and one undo step, so
 * debouncing per settled edit is exact rather than approximate.
 *
 * ## The rule this hook exists to get right
 *
 * **A dependency change may cancel a pending debounce. It may never cancel an
 * in-flight request.** `saveStarted` is cleared only by `saveSucceeded` or
 * `saveFailed`, so a request whose outcome is dropped leaves the session
 * `saving` forever and `pendingWrite` null forever — autosave dies silently on
 * the first write and never recovers.
 *
 * That is not hypothetical. The obvious shape — a per-run `let cancelled` set
 * by the effect's cleanup — does exactly this, because the *first* thing a
 * started save does is change the deps: `onSaveStarted()` makes `pendingWrite`
 * return null, React tears down the run that issued the request, and the
 * request's own handlers are the thing it silences.
 *
 * So the request's handlers are guarded by a **mount** flag owned by a separate
 * empty-dependency effect, whose cleanup runs once, at unmount. A dep change
 * then cancels only a timer that has not fired; a request that has been issued
 * always reports.
 */
export function useAutosave(
  session: EditorSession,
  client: Client | null,
  handlers: AutosaveHandlers,
  timings: AutosaveTimings = {},
): void {
  // Read through a ref so a change of handler identity cannot restart the
  // debounce; only the document settling should do that. Written in an effect
  // rather than during render because a render may be discarded, and the only
  // readers are a timer and a promise — both strictly after commit.
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  });

  // Owned by an empty-dependency effect, so its cleanup runs once — at unmount
  // — and nothing else can silence a request that has already been sent.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const write = pendingWrite(session);
  const retrying = session.status === "error";

  const debounceMs = timings.debounceMs ?? AUTOSAVE_DEBOUNCE_MS;
  const retryMs = timings.retryMs ?? AUTOSAVE_RETRY_MS;

  useEffect(() => {
    if (!client || !write) return;

    const timer = setTimeout(
      () => {
        handlersRef.current.onSaveStarted();

        // The revision being sent, captured before anything can move on. The
        // server acknowledges *this* number, not whatever the document holds
        // when the response lands.
        const sent = write.doc.revision;
        const request =
          write.kind === "create"
            ? client.createList(write.doc)
            : client.updateList(write.doc, write.expectedRevision);

        request.then(
          () => {
            if (mounted.current) handlersRef.current.onSaveSucceeded(sent);
          },
          (error: unknown) => {
            if (!mounted.current) return;
            // 409 is the API's "someone else wrote first". Everything else —
            // a dead network, a 500 — is transient and worth retrying.
            const conflict = error instanceof ApiError && error.status === 409;
            handlersRef.current.onSaveFailed(conflict ? "conflict" : "offline");
          },
        );
      },
      retrying ? retryMs : debounceMs,
    );

    // Only the timer. Cancelling the request here is the defect described
    // above; see also `saveStarted` in @tl/editor-core/src/session.ts.
    return () => clearTimeout(timer);

    // Keyed on what actually decides the write, never on `write` itself —
    // `pendingWrite` builds a fresh object every render, so keying on it would
    // restart the debounce on every unrelated re-render and a document under
    // steady re-rendering would never save at all.
    //
    // `write.doc` is the document that would be sent: stable across re-renders,
    // new on every edit, which is exactly when the debounce should restart.
    // `retrying` is included because it changes the delay; every transition
    // into or out of `error` also changes another dependency, so it cannot
    // restart a debounce on its own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    client,
    write?.kind,
    write?.doc,
    write?.kind === "update" ? write.expectedRevision : null,
    retrying,
    debounceMs,
    retryMs,
  ]);
}
