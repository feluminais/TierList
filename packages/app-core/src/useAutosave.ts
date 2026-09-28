"use client";

import { ApiError, type Client } from "@tl/api-client";
import { pendingWrite, type EditorSession, type PendingWrite } from "@tl/editor-core";
import { useCallback, useEffect, useRef } from "react";

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

export interface Autosave {
  /**
   * Send the save that is waiting on its timer, now, with `keepalive` so the
   * request can outlive the page. For the moment a page is hidden or closed —
   * each platform calls it from its own lifecycle event. Does nothing when no
   * save is waiting. Stable across renders.
   */
  flush: () => void;
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
 * ## The rules this hook exists to get right
 *
 * **A dependency change may cancel a pending debounce. It may never cancel an
 * in-flight request.** `saveStarted` is cleared only by `saveSucceeded` or
 * `saveFailed`, so a request whose outcome is dropped leaves the session
 * `saving` forever and `pendingWrite` null forever — autosave dies silently.
 * The first thing a started save does is change the deps (`onSaveStarted()`
 * makes `pendingWrite` return null), so a per-run "cancelled" flag would
 * silence exactly the request it just issued. The request's handlers are
 * guarded instead by a **mount** flag owned by a separate empty-dependency
 * effect, whose cleanup runs once, at unmount.
 *
 * **Leaving never drops a waiting save.** Unmounting — navigating elsewhere in
 * the app — sends a save still waiting on its timer instead of cancelling it
 * with the timer, and `flush` does the same for a page being hidden or closed.
 * Which save is waiting is tracked apart from the timer's own effect, so it
 * does not matter in which order React runs the cleanups at unmount.
 */
export function useAutosave(
  session: EditorSession,
  client: Client | null,
  handlers: AutosaveHandlers,
  timings: AutosaveTimings = {},
): Autosave {
  // Read through a ref so a change of handler identity cannot restart the
  // debounce; only the document settling should do that. Written in an effect
  // rather than during render because a render may be discarded, and the only
  // readers are a timer, a promise and `flush` — all strictly after commit.
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  });

  const write = pendingWrite(session);
  const retrying = session.status === "error";

  // The newest committed write and client, for `flush`, which runs from a
  // lifecycle event or an unmount rather than from a render.
  const latest = useRef<{ write: PendingWrite | null; client: Client | null }>({
    write: null,
    client: null,
  });
  useEffect(() => {
    latest.current = { write, client };
  });

  // The timer of the save that is waiting, or null when none is. Cleared by
  // the timer itself and by `flush`, never by an effect cleanup — see above.
  const waiting = useRef<ReturnType<typeof setTimeout> | null>(null);

  const mounted = useRef(true);

  const send = useCallback((pending: PendingWrite, to: Client, keepalive: boolean) => {
    if (mounted.current) handlersRef.current.onSaveStarted();

    // The revision being sent, captured before anything can move on. The
    // server acknowledges *this* number, not whatever the document holds when
    // the response lands.
    const sent = pending.doc.revision;
    const options = keepalive ? { keepalive: true } : undefined;
    const request =
      pending.kind === "create"
        ? to.createList(pending.doc, options)
        : to.updateList(pending.doc, pending.expectedRevision, options);

    request.then(
      () => {
        if (mounted.current) handlersRef.current.onSaveSucceeded(sent);
      },
      (error: unknown) => {
        if (!mounted.current) return;
        // 409 is the API's "someone else wrote first". Everything else — a
        // dead network, a 500 — is transient and worth retrying.
        const conflict = error instanceof ApiError && error.status === 409;
        handlersRef.current.onSaveFailed(conflict ? "conflict" : "offline");
      },
    );
  }, []);

  const flush = useCallback(() => {
    const timer = waiting.current;
    const { write: pending, client: to } = latest.current;
    if (timer === null || !pending || !to) return;
    // Cancelled here, not left to the re-render `onSaveStarted` causes: that
    // render is scheduled, and the timer can fire before it runs.
    clearTimeout(timer);
    waiting.current = null;
    send(pending, to, true);
  }, [send]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      flush();
    };
  }, [flush]);

  const debounceMs = timings.debounceMs ?? AUTOSAVE_DEBOUNCE_MS;
  const retryMs = timings.retryMs ?? AUTOSAVE_RETRY_MS;

  useEffect(() => {
    if (!client || !write) {
      waiting.current = null;
      return;
    }

    const timer = setTimeout(
      () => {
        waiting.current = null;
        send(write, client, false);
      },
      retrying ? retryMs : debounceMs,
    );
    waiting.current = timer;

    // Only the timer. Cancelling the request here is the failure described
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

  return { flush };
}
