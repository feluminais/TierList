"use client";

import type { AssetResponse } from "@tl/api-client";
import {
  createTierList,
  defaultImageEdit,
  reduce,
  type TierList,
  type TierListAction,
  type TileAspect,
} from "@tl/core";
import {
  applyAction,
  aspectRatioFor,
  createSession,
  defaultCropFor,
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
  useRef,
  useState,
  type ComponentType,
} from "react";
import { downloadBytes, filenameFor } from "./download";
import { EditSheet, type EditCanvasComponent } from "./EditSheet";
import { TileEditOverlay } from "./TileEditButton";
import { Toolbar } from "./Toolbar";
import { useApiClient } from "./useApiClient";
import { useAssetUpload } from "./useAssetUpload";
import { useAutosave, type AutosaveHandlers } from "./useAutosave";
import { useShare } from "./useShare";

/**
 * `@tl/editor`'s `BoardExporter`, restated rather than imported — the same
 * constraint that makes `EditSheet` restate `EditCanvas`'s props. Nothing
 * Skia-related may be named at module scope in this file, and a type-only
 * import still ties the module to a package that builds its Skia API object
 * when it loads.
 */
type BoardExporterLike = {
  toImage: (format: "png" | "jpg") => { bytes: Uint8Array; contentType: string } | null;
};

type BoardProps = {
  doc: TierList;
  width: number;
  onAction: (action: TierListAction) => void;
  onTap?: (itemId: string) => void;
  onDraggingChange?: (dragging: boolean) => void;
  immediateDrag?: boolean;
  onExporterReady?: (exporter: BoardExporterLike | null) => void;
  assetIds?: readonly string[];
  assetUrl?: (assetId: string) => string;
};

/**
 * The board fills the width it is given, within limits, and is centred in it.
 *
 * This is also the width of the surface below that claims touch input, so the
 * two cannot drift apart.
 *
 * It was fixed at 800px, which was wrong at both ends: it wasted most of a
 * desktop window while leaving a phone cramped at roughly two tiles per line.
 * The floor stops a narrow screen collapsing the tiles area to nothing; the
 * ceiling stops a tier row becoming an unscannable ribbon on an ultrawide,
 * where the eye has to travel the whole screen to compare two tiles.
 *
 * The width is measured, not guessed from a breakpoint, because `layoutBoard`
 * takes a number and everything downstream — hit-testing, drag targeting, the
 * hover overlay — must be given the *same* number the canvas was drawn with.
 */
const MIN_BOARD_WIDTH = 320;
const MAX_BOARD_WIDTH = 1400;

/**
 * What the board is laid out at before it has been measured. Only ever visible
 * for the first paint, and the canvas itself does not mount until CanvasKit has
 * loaded, so this is never seen as a reflow.
 */
const DEFAULT_BOARD_WIDTH = 800;

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

  // Whether this device has a mouse (or other precise pointer) rather than
  // only touch. Read in an effect, not during render, for the same reason
  // `listId` is: `matchMedia` does not exist on the server, and a render-time
  // read would make the server and the first client render disagree. Starts
  // false — the touch-first behaviour — so hydration matches, then flips
  // immediately after mount on a device that actually has one.
  //
  // Decided here, not inside `@tl/editor`: `dragReduce` and `InteractiveBoard`
  // are shared with the Android app and must stay platform-agnostic, so the
  // device check belongs to this web-only caller.
  const [pointerFine, setPointerFine] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(pointer: fine)");
    const update = () => setPointerFine(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  // True for the span of a drag. `InteractiveBoard` reports it precisely so a
  // parent can react — here, to hide the hover edit button while a tile is
  // being dragged rather than edited.
  const [dragging, setDragging] = useState(false);

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

  // Reads `display.tileAspect` from the functional `setSession` update rather
  // than from the `session` this callback closed over: `useAssetUpload` holds
  // this callback for the lifetime of an upload, which can outlive several
  // re-renders (a tile-size change, an unrelated edit) between the upload
  // starting and the server responding. Reading a captured `session` here
  // would silently lock the crop to whatever aspect was current when the
  // *upload started*, not when it finished — exactly the stale-read bug this
  // fix exists to avoid.
  const onUploaded = useCallback((asset: AssetResponse) => {
    const id = newId();
    setSession((current) => {
      const crop = defaultCropFor(
        { width: asset.width, height: asset.height },
        aspectRatioFor(current.doc.display.tileAspect),
      );
      const edit = { ...defaultImageEdit(), crop };
      return applyAction(
        current,
        { type: "item/addImage", id, assetId: asset.id, edit },
        now(),
      );
    });
  }, []);
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
  const onRowTileSize = useCallback(
    (rowId: string, tileSize: number | null) =>
      dispatch({ type: "row/setTileSize", rowId, tileSize }),
    [dispatch],
  );
  const onTileAspect = useCallback(
    (tileAspect: TileAspect) => dispatch({ type: "display/set", patch: { tileAspect } }),
    [dispatch],
  );

  // Handed over by `InteractiveBoard` once its canvas exists, and taken back
  // on unmount. Null means "there is nothing to snapshot yet", which is what
  // greys out the image export buttons rather than letting a click fail.
  const [exporter, setExporter] = useState<BoardExporterLike | null>(null);
  // Stable: it keys the effect inside `InteractiveBoard` that calls it, and an
  // unstable one would hand over a fresh exporter on every render.
  const onExporterReady = useCallback(
    (next: BoardExporterLike | null) => setExporter(() => next),
    [],
  );

  const onExportImage = useCallback(
    (format: "png" | "jpg") => {
      const image = exporter?.toImage(format);
      if (!image) return;
      downloadBytes(image.bytes, image.contentType, filenameFor(session.doc.title, format));
    },
    [exporter, session.doc.title],
  );

  /**
   * The document itself, as a file.
   *
   * The design doc's answer to "it's just a picture after you create it", and
   * cheap precisely because the document already *is* the source of truth —
   * there is nothing to serialise that autosave does not already send. Pretty
   * printed: this is meant to be readable by whoever receives it.
   */
  const onExportJson = useCallback(() => {
    downloadBytes(
      JSON.stringify(session.doc, null, 2),
      "application/json",
      filenameFor(session.doc.title, "json"),
    );
  }, [session.doc]);

  // JPEG for the link preview, not PNG: a board of photographs encodes to a
  // fraction of the size, and "opens fast" is half of what this milestone is
  // for. Every OG consumer accepts JPEG.
  const ogImage = useCallback(() => exporter?.toImage("jpg") ?? null, [exporter]);
  const shareUrlFor = useCallback(
    (code: string) => `${window.location.origin}/l/${code}`,
    [],
  );
  const sharing = useShare(client, listId, ogImage, shareUrlFor);

  // Which tile a sheet is open for, if any. `onTap` is the handler
  // `useBoardGesture`/`dragReduce` have had a slot for since Milestone 2D —
  // "2D gives this a meaning" never happened until now.
  //
  // Below, this only reaches the board as `onTap` when `!pointerFine`: a
  // hover-capable device gets the corner button instead (a click is free once
  // a drag starts immediately, so a plain tap opening the sheet would take
  // over the click a drag also wants). Touch keeps `onTap`, because touch has
  // no hover and would otherwise have no way to reach the sheet at all —
  // giving it a real affordance of its own is Milestone 8's problem.
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

  // Measured rather than read from a media query: `layoutBoard` takes a number,
  // and the canvas, the hit-testing and the hover overlay must all be handed
  // the same one or a drop lands somewhere the user did not aim.
  const shellRef = useRef<HTMLDivElement | null>(null);
  const [boardWidth, setBoardWidth] = useState(DEFAULT_BOARD_WIDTH);
  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;
    const measure = () => {
      setBoardWidth(
        Math.max(MIN_BOARD_WIDTH, Math.min(MAX_BOARD_WIDTH, shell.clientWidth)),
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(shell);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={shellRef} style={{ width: "100%" }}>
    <div style={{ width: boardWidth, maxWidth: "100%", margin: "0 auto" }}>
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
        onRowTileSize={onRowTileSize}
        onTileAspect={onTileAspect}
        onExportImage={exporter ? onExportImage : null}
        onExportJson={onExportJson}
        onShare={client && listId ? sharing.share : null}
        sharing={sharing.sharing}
        shareUrl={sharing.url}
        shareError={sharing.error}
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
        //
        // The hover overlay is only mounted on a hover-capable device: touch
        // has no hover to track and no need for the extra wrapper, so the
        // touch path stays exactly what it was.
        pointerFine ? (
          <TileEditOverlay doc={session.doc} width={boardWidth} dragging={dragging} onEdit={onTap}>
            <div style={{ touchAction: "none", width: boardWidth }}>
              <Board
                doc={session.doc}
                width={boardWidth}
                onAction={dispatch}
                onDraggingChange={setDragging}
                immediateDrag
                onExporterReady={onExporterReady}
                assetIds={assetIds}
                assetUrl={assetUrl}
              />
            </div>
          </TileEditOverlay>
        ) : (
          <div style={{ touchAction: "none", width: boardWidth }}>
            <Board
              doc={session.doc}
              width={boardWidth}
              onAction={dispatch}
              onTap={onTap}
              onExporterReady={onExporterReady}
              assetIds={assetIds}
              assetUrl={assetUrl}
            />
          </div>
        )
      )}
      {editingItem && EditCanvasComp ? (
        <EditSheet
          item={editingItem}
          EditCanvas={EditCanvasComp}
          // The number, not the name: `aspectRatioFor` is the one place the
          // mapping lives, and `layoutBoard` reads it from there too, so the
          // sheet and the board cannot drift into disagreeing about what
          // "portrait" means.
          tileAspect={aspectRatioFor(session.doc.display.tileAspect)}
          assetUrl={assetUrl}
          onAction={dispatch}
          onClose={() => setEditing(null)}
        />
      ) : null}
      </div>
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
