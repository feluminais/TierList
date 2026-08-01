"use client";

import { createTierList, reduce, type TierList, type TierListAction } from "@tl/core";
import {
  applyAction,
  createSession,
  redoSession,
  saveFailed,
  saveStarted,
  saveSucceeded,
  undoSession,
} from "@tl/editor-core";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ComponentType,
} from "react";
import { Toolbar } from "./Toolbar";
import { useApiClient } from "./useApiClient";
import { useAutosave, type AutosaveHandlers } from "./useAutosave";

type BoardProps = {
  doc: TierList;
  width: number;
  onAction: (action: TierListAction) => void;
};

/** Width the board is laid out against. Also the width of the surface below
 *  that claims touch input, so the two cannot drift apart. */
const BOARD_WIDTH = 800;

/**
 * Nothing Skia-related may be imported at module scope in this file.
 *
 * `@shopify/react-native-skia/lib/module/skia/Skia.web.js` builds its API
 * object at module scope:
 *
 *     export const Skia = JsiSkApi(global.CanvasKit);
 *
 * so that module must not be evaluated until after CanvasKit is on the global.
 * Doing both imports dynamically, in order, inside the effect makes that
 * ordering explicit instead of relying on bundler chunking — which the spike
 * proved differs between dev and production, and not in the direction anyone
 * assumed.
 */
export default function SkiaHost() {
  const [Board, setBoard] = useState<ComponentType<BoardProps> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { LoadSkiaWeb } = await import(
          "@shopify/react-native-skia/lib/module/web/LoadSkiaWeb"
        );
        // CanvasKit derives its own WASM URL from a module URL that Turbopack
        // rewrites with a ROOT/ prefix, producing a 404. Naming the path
        // explicitly is the fix.
        await LoadSkiaWeb({ locateFile: (file: string) => `/${file}` });

        const mod = await import("@tl/editor");
        if (!alive) return;
        setBoard(() => mod.InteractiveBoard);
      } catch (e) {
        if (alive) setError(String(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // The document, its history and its saved state, together. `null` for the
  // synced revision says the server has never seen this document, so the first
  // write will be a create.
  const [session, setSession] = useState(() => createSession(sampleDoc(), null));

  // The clock lives here, at the boundary, exactly as it does in the gesture
  // hook. A drag emits at most one action, so this runs once per completed
  // drag and not once per frame.
  //
  // `applyAction` returns the *same session* for a no-op, so React bails out of
  // the re-render and the autosave debounce is never restarted by an edit that
  // changed nothing.
  const dispatch = useCallback((action: TierListAction) => {
    setSession((current) => applyAction(current, action, now()));
  }, []);

  const undo = useCallback(() => {
    setSession((current) => undoSession(current, now()));
  }, []);
  const redo = useCallback(() => {
    setSession((current) => redoSession(current, now()));
  }, []);

  const onTitleChange = useCallback(
    (title: string) => dispatch({ type: "meta/set", patch: { title } }),
    [dispatch],
  );
  // The id is minted here, at the call site, and never inside the component
  // that collected the label.
  const onAddItem = useCallback(
    (label: string) => dispatch({ type: "item/addText", id: newId(), label }),
    [dispatch],
  );

  // `process.env.NEXT_PUBLIC_API_URL` is written out in full so the bundler can
  // inline it; a destructured or computed read is not substituted.
  const connection = useApiClient(process.env.NEXT_PUBLIC_API_URL);
  const client = connection.state === "connected" ? connection.client : null;

  // Stable, and every one of them a functional update, so the hook can hold
  // them behind a ref without ever reading a stale session.
  const handlers = useMemo<AutosaveHandlers>(
    () => ({
      onSaveStarted: () => setSession((current) => saveStarted(current)),
      onSaveSucceeded: (acknowledged) =>
        setSession((current) => saveSucceeded(current, acknowledged)),
      onSaveFailed: (failure) =>
        setSession((current) => saveFailed(current, failure)),
    }),
    [],
  );

  useAutosave(session, client, handlers);

  return (
    <div style={{ width: BOARD_WIDTH, maxWidth: "100%" }}>
      <Toolbar
        session={session}
        connection={connection}
        onTitleChange={onTitleChange}
        onAddItem={onAddItem}
        onUndo={undo}
        onRedo={redo}
      />
      {error ? (
        <pre style={{ color: "#f88", padding: 16 }}>{error}</pre>
      ) : !Board ? (
        <p style={{ color: "#888", padding: 16 }}>Loading canvas…</p>
      ) : (
        // `touch-action: none` is the only thing that stops a mobile browser
        // stealing a drag. Once Chrome decides a touch belongs to a scroll it
        // fires `touchcancel`, and react-native-web's responder system
        // terminates on that path unconditionally — it consults
        // `onResponderTerminationRequest` only for `contextmenu`, `scroll` and
        // `selectionchange` (ResponderSystem.js, `isTerminateEvent`). Returning
        // `false` cannot save the gesture, so the browser has to be stopped
        // from claiming it at all. react-native-web reaches for the same lever
        // for the same reason, and says so: see the comment above
        // `scrollDisabled` in ScrollViewBase.
        //
        // The cost is that this surface no longer pans the page on a touch
        // screen. Sized to the board rather than the block default so it costs
        // exactly the board and not the empty column beside it.
        //
        // Autoscroll is deliberately not wired here. This route still has no
        // scroll container of its own — the page scrolls — so there is no
        // viewport to measure a pointer against and no scroller to drive. It is
        // exercised on mobile, where the board sits inside a ScrollView.
        <div style={{ touchAction: "none", width: BOARD_WIDTH }}>
          <Board doc={session.doc} width={BOARD_WIDTH} onAction={dispatch} />
        </div>
      )}
    </div>
  );
}

function now(): string {
  return new Date().toISOString();
}

/**
 * A fresh item id.
 *
 * `crypto.randomUUID` is the right source — a module-scope counter would
 * collide between two tabs editing the same list — but it exists only in
 * *secure contexts*, so it is absent over plain http to a LAN address, which is
 * exactly how a phone reaches a dev server. The fallback is not
 * cryptographically anything; it only has to not collide.
 *
 * Called from an event handler, never during render, so it cannot run on the
 * server.
 */
function newId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `item-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** A throwaway document so there is something to look at. Loading a real one
 *  needs a list id in the route, which is Milestone 3's shape, not this one's. */
function sampleDoc(): TierList {
  const seeded = "2026-08-01T12:00:00.000Z";
  let doc = createTierList({ id: "preview", now: seeded });
  const labels = ["Ramen", "Udon", "Soba", "Pho", "Laksa", "Bun bo Hue"];
  labels.forEach((label, i) => {
    doc = reduce(doc, { type: "item/addText", id: `i${i}`, label }, seeded);
  });
  doc = reduce(doc, { type: "placement/place", itemId: "i0", rowId: "preview-row-0", index: 0 }, seeded);
  doc = reduce(doc, { type: "placement/place", itemId: "i1", rowId: "preview-row-0", index: 1 }, seeded);
  doc = reduce(doc, { type: "placement/place", itemId: "i2", rowId: "preview-row-1", index: 0 }, seeded);
  return doc;
}
