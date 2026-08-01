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
import { EditSheet, type EditCanvasComponent } from "./EditSheet";
import { Toolbar } from "./Toolbar";
import { useApiClient } from "./useApiClient";
import { useAssetUpload } from "./useAssetUpload";
import { useAutosave, type AutosaveHandlers } from "./useAutosave";

type BoardProps = {
  doc: TierList;
  width: number;
  onAction: (action: TierListAction) => void;
  onTap?: (itemId: string) => void;
  assetIds?: readonly string[];
  assetUrl?: (assetId: string) => string;
};

/** Width the board is laid out against. Also the width of the surface below
 *  that claims touch input, so the two cannot drift apart. */
const BOARD_WIDTH = 800;

/** Where this browser's list id is remembered between visits. */
const LIST_ID_KEY = "tl.listId";

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
  const [EditCanvasComp, setEditCanvasComp] = useState<EditCanvasComponent | null>(null);
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
        setEditCanvasComp(() => mod.EditCanvas);
      } catch (e) {
        if (alive) setError(String(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // The list this page edits. Persisted so a reload returns to the same
  // document — which is Milestone 3's actual acceptance test. Chosen in an
  // effect rather than during render because `localStorage` does not exist on
  // the server and a value read during render would differ between the two.
  const [listId, setListId] = useState<string | null>(null);
  useEffect(() => {
    let id = window.localStorage.getItem(LIST_ID_KEY);
    if (!id) {
      id = newId();
      window.localStorage.setItem(LIST_ID_KEY, id);
    }
    setListId(id);
  }, []);

  // The document, its history and its saved state, together. `null` for the
  // synced revision says the server has never seen this document, so the first
  // write will be a create. This placeholder is replaced the moment `listId`
  // (and, if there is a client, a load) resolves — see the effect below — so
  // it is never what a save actually goes out against.
  const [session, setSession] = useState(() => createSession(sampleDoc("preview"), null));
  // Whether `session` is actually the list this route means to edit, rather
  // than the "preview" placeholder above. Gates autosave below: without it, a
  // slow `getList` round trip leaves the placeholder's `syncedRevision: null`
  // in place for up to a whole debounce window, which is enough on a slow
  // connection for autosave to issue a real `createList` for a document
  // nobody asked to save, under an id ("preview") a real list will never
  // reuse.
  const [loaded, setLoaded] = useState(false);

  // `process.env.NEXT_PUBLIC_API_URL` is written out in full so the bundler can
  // inline it; a destructured or computed read is not substituted.
  const connection = useApiClient(process.env.NEXT_PUBLIC_API_URL);
  const client = connection.state === "connected" ? connection.client : null;

  useEffect(() => {
    if (!listId) return;
    if (!client) {
      // No API configured is the normal state of this route. Start a local
      // document under the real id so nothing downstream has to special-case it.
      setSession(createSession(sampleDoc(listId), null));
      setLoaded(true);
      return;
    }
    let alive = true;
    (async () => {
      const existing = await client.getList(listId).catch(() => null);
      if (!alive) return;
      // A document the server already holds starts *synced* at its own
      // revision. Starting at null would make the first write a create, which
      // the create-only PUT rejects with a 409 — landing a returning visitor
      // straight in conflict. That is exactly the open item this fixes.
      setSession(
        existing
          ? createSession(existing, existing.revision)
          : createSession(sampleDoc(listId), null),
      );
      setLoaded(true);
    })();
    return () => {
      alive = false;
    };
  }, [listId, client]);

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

  const onUploaded = useCallback(
    (assetId: string) => dispatch({ type: "item/addImage", id: newId(), assetId }),
    [dispatch],
  );
  const upload = useAssetUpload(client, onUploaded);
  const onAddImage = useCallback((file: File) => void upload.upload(file), [upload]);

  const assetUrl = useCallback(
    (id: string) => (client ? client.assetUrl(id) : ""),
    [client],
  );
  // Gated on `client` rather than only on the document: an id with nowhere to
  // fetch from would still get handed to `Skia.Data.fromURI("")`, which
  // resolves against *this page's own URL* rather than rejecting or hanging —
  // a wasted request that decodes as garbage and marks the tile "failed" for
  // no reason a user could act on. Simplest to just not ask.
  const assetIds = useMemo(
    () =>
      client ? session.doc.items.map((i) => i.assetId).filter((a): a is string => !!a) : [],
    [session.doc.items, client],
  );

  const onTileSize = useCallback(
    (tileSize: number) => dispatch({ type: "display/set", patch: { tileSize } }),
    [dispatch],
  );

  // Which tile a tap opened a sheet for, if any. `onTap` is the handler
  // `useBoardGesture`/`dragReduce` have had a slot for since Milestone 2D —
  // "2D gives this a meaning" never happened until now.
  const [editing, setEditing] = useState<string | null>(null);
  const onTap = useCallback((itemId: string) => setEditing(itemId), []);
  const editingItem = editing
    ? session.doc.items.find((i) => i.id === editing)
    : undefined;
  useEffect(() => {
    // The item a sheet is open on can vanish from under it — removed, or an
    // undo reaching back past when it was added. `item/setEdit` guards on a
    // missing item and is a no-op (packages/core/src/reduce.ts), so nothing
    // corrupts, but a sheet left open over a tile that no longer exists is a
    // worse experience than one that closes.
    if (editing && !editingItem) setEditing(null);
  }, [editing, editingItem]);

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

  useAutosave(session, loaded ? client : null, handlers);

  return (
    <div style={{ width: BOARD_WIDTH, maxWidth: "100%" }}>
      <Toolbar
        session={session}
        connection={connection}
        onTitleChange={onTitleChange}
        onAddItem={onAddItem}
        onUndo={undo}
        onRedo={redo}
        onAddImage={onAddImage}
        uploading={upload.uploading}
        uploadError={upload.error}
        tileSize={session.doc.display.tileSize}
        onTileSize={onTileSize}
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
          <Board
            doc={session.doc}
            width={BOARD_WIDTH}
            onAction={dispatch}
            onTap={onTap}
            assetIds={assetIds}
            assetUrl={assetUrl}
          />
        </div>
      )}
      {editingItem && EditCanvasComp ? (
        <EditSheet
          item={editingItem}
          EditCanvas={EditCanvasComp}
          assetUrl={assetUrl}
          onAction={dispatch}
          onClose={() => setEditing(null)}
        />
      ) : null}
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

/** A throwaway document so there is something to look at before a real list
 *  id has been chosen (see the `listId` effect) or while disconnected. */
function sampleDoc(id: string): TierList {
  const seeded = "2026-08-01T12:00:00.000Z";
  let doc = createTierList({ id, now: seeded });
  // Rows are derived from the id by createTierList (`${id}-row-${i}`), so
  // reference them by index rather than hard-coding a value that was only ever
  // right for id === "preview". Getting this wrong is silent: a stale row id
  // matches nothing, `placement/place` no-ops, and the board renders with
  // every item stuck in the tray and no error anywhere.
  const rows = doc.rows.map((r) => r.id);
  const labels = ["Ramen", "Udon", "Soba", "Pho", "Laksa", "Bun bo Hue"];
  labels.forEach((label, i) => {
    doc = reduce(doc, { type: "item/addText", id: `i${i}`, label }, seeded);
  });
  doc = reduce(doc, { type: "placement/place", itemId: "i0", rowId: rows[0]!, index: 0 }, seeded);
  doc = reduce(doc, { type: "placement/place", itemId: "i1", rowId: rows[0]!, index: 1 }, seeded);
  doc = reduce(doc, { type: "placement/place", itemId: "i2", rowId: rows[1]!, index: 0 }, seeded);
  return doc;
}
